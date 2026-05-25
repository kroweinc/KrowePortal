import { unstable_cache } from "next/cache";
import { githubFetch } from "./client";

const PER_PAGE = 100;
const MAX_PAGES = 2;
const HARD_CAP = 200;
const PAIRWISE_CAP = 20;
const REVALIDATE_SECONDS = 1800;

export type BranchNode = {
  name: string;
  tipSha: string;
  tipShaFull: string;
  latestCommit: { message: string; date: string } | null;
  children: BranchNode[];
  parentName: string | null;
  diverged: boolean;
};

export type BranchGraph = {
  root: BranchNode;
  truncated: boolean;
  pairwise: boolean;
  degraded: string[];
};

type GhBranch = { name: string; commit: { sha: string } };
type GhCommit = {
  sha: string;
  commit: { message: string; author: { date: string } | null };
};
type GhCompare = {
  merge_base_commit: { sha: string };
};

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

async function listBranches(
  token: string,
  owner: string,
  repo: string,
  degraded: string[]
): Promise<{ branches: GhBranch[]; truncated: boolean }> {
  const out: GhBranch[] = [];
  let truncated = false;

  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      const path = `/repos/${owner}/${repo}/branches?per_page=${PER_PAGE}&page=${page}`;
      const res = await githubFetch<GhBranch[]>(path, token);
      out.push(...res);
      if (res.length < PER_PAGE) return { branches: out.slice(0, HARD_CAP), truncated: false };
      if (out.length >= HARD_CAP) {
        return { branches: out.slice(0, HARD_CAP), truncated: true };
      }
    } catch {
      if (page === 1) throw new Error("branches:page-1");
      degraded.push(`branches:page-${page}`);
      return { branches: out.slice(0, HARD_CAP), truncated };
    }
  }

  // Exhausted MAX_PAGES with full pages — likely more remain.
  truncated = true;
  return { branches: out.slice(0, HARD_CAP), truncated };
}

async function fetchTipCommits(
  token: string,
  owner: string,
  repo: string,
  branches: GhBranch[],
  degraded: string[]
): Promise<Map<string, { message: string; date: string }>> {
  const results = await Promise.allSettled(
    branches.map((b) =>
      githubFetch<GhCommit>(`/repos/${owner}/${repo}/commits/${b.commit.sha}`, token).then(
        (commit) => ({ name: b.name, commit })
      )
    )
  );

  const map = new Map<string, { message: string; date: string }>();
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const branch = branches[i];
    if (r.status === "fulfilled") {
      const msg = r.value.commit.commit.message.split("\n")[0].slice(0, 200);
      const date = r.value.commit.commit.author?.date ?? "";
      map.set(branch.name, { message: msg, date });
    } else {
      degraded.push(`tip:${branch.name}`);
    }
  }
  return map;
}

type MergeBaseMap = Map<string, string>; // key = "A->B", value = merge_base sha

function mergeKey(a: string, b: string): string {
  return `${a}->${b}`;
}

async function fetchPairwiseMergeBases(
  token: string,
  owner: string,
  repo: string,
  branchNames: string[],
  degraded: string[]
): Promise<MergeBaseMap> {
  const pairs: { a: string; b: string }[] = [];
  for (const a of branchNames) {
    for (const b of branchNames) {
      if (a !== b) pairs.push({ a, b });
    }
  }

  const results = await Promise.allSettled(
    pairs.map(({ a, b }) =>
      githubFetch<GhCompare>(
        `/repos/${owner}/${repo}/compare/${encodeURIComponent(a)}...${encodeURIComponent(b)}?per_page=1`,
        token
      ).then((cmp) => ({ a, b, sha: cmp.merge_base_commit.sha }))
    )
  );

  const map: MergeBaseMap = new Map();
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const { a, b } = pairs[i];
    if (r.status === "fulfilled") {
      map.set(mergeKey(a, b), r.value.sha);
    } else {
      degraded.push(`compare:${a}...${b}`);
    }
  }
  return map;
}

async function fetchDefaultMergeBases(
  token: string,
  owner: string,
  repo: string,
  defaultBranch: string,
  nonDefaultBranches: string[],
  degraded: string[]
): Promise<MergeBaseMap> {
  const results = await Promise.allSettled(
    nonDefaultBranches.map((b) =>
      githubFetch<GhCompare>(
        `/repos/${owner}/${repo}/compare/${encodeURIComponent(defaultBranch)}...${encodeURIComponent(b)}?per_page=1`,
        token
      ).then((cmp) => ({ b, sha: cmp.merge_base_commit.sha }))
    )
  );

  const map: MergeBaseMap = new Map();
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const b = nonDefaultBranches[i];
    if (r.status === "fulfilled") {
      map.set(mergeKey(defaultBranch, b), r.value.sha);
    } else {
      degraded.push(`compare:${defaultBranch}...${b}`);
    }
  }
  return map;
}

type ParentInfo = { parent: string; diverged: boolean };

function inferParentsPairwise(
  branchNames: string[],
  defaultBranch: string,
  tipFullByName: Map<string, string>,
  tipDateByName: Map<string, string>,
  mb: MergeBaseMap
): Map<string, ParentInfo> {
  const parents = new Map<string, ParentInfo>();
  for (const b of branchNames) {
    if (b === defaultBranch) continue;

    const candidates: { name: string; date: string }[] = [];
    for (const a of branchNames) {
      if (a === b) continue;
      const mbSha = mb.get(mergeKey(a, b));
      if (!mbSha) continue;
      const aTip = tipFullByName.get(a);
      if (aTip && aTip === mbSha) {
        candidates.push({ name: a, date: tipDateByName.get(a) ?? "" });
      }
    }

    if (candidates.length > 0) {
      // Closest parent = candidate whose tip commit is most recent.
      // If A is on B's history AND C is on B's history AND A is also on C's history,
      // then C is closer to B (more recent tip date).
      candidates.sort((x, y) => (y.date > x.date ? 1 : y.date < x.date ? -1 : 0));
      parents.set(b, { parent: candidates[0].name, diverged: false });
      continue;
    }

    // Fall back: check vs default
    const defaultMb = mb.get(mergeKey(defaultBranch, b));
    const defaultTip = tipFullByName.get(defaultBranch);
    if (defaultMb && defaultTip && defaultMb === defaultTip) {
      parents.set(b, { parent: defaultBranch, diverged: false });
    } else {
      parents.set(b, { parent: defaultBranch, diverged: true });
    }
  }
  return parents;
}

function inferParentsFallback(
  branchNames: string[],
  defaultBranch: string,
  tipFullByName: Map<string, string>,
  mb: MergeBaseMap
): Map<string, ParentInfo> {
  const parents = new Map<string, ParentInfo>();
  const defaultTip = tipFullByName.get(defaultBranch);

  for (const b of branchNames) {
    if (b === defaultBranch) continue;
    const mbSha = mb.get(mergeKey(defaultBranch, b));
    if (!mbSha) {
      parents.set(b, { parent: defaultBranch, diverged: true });
      continue;
    }
    if (defaultTip && mbSha === defaultTip) {
      parents.set(b, { parent: defaultBranch, diverged: false });
      continue;
    }
    let matched: string | null = null;
    for (const [name, tip] of tipFullByName.entries()) {
      if (name === defaultBranch || name === b) continue;
      if (tip === mbSha) {
        matched = name;
        break;
      }
    }
    if (matched) {
      parents.set(b, { parent: matched, diverged: false });
    } else {
      parents.set(b, { parent: defaultBranch, diverged: true });
    }
  }
  return parents;
}

function buildNodes(
  branchNames: string[],
  defaultBranch: string,
  tipFullByName: Map<string, string>,
  latestCommits: Map<string, { message: string; date: string }>,
  parents: Map<string, ParentInfo>
): BranchNode {
  const nodeByName = new Map<string, BranchNode>();
  for (const name of branchNames) {
    const full = tipFullByName.get(name) ?? "";
    nodeByName.set(name, {
      name,
      tipSha: shortSha(full),
      tipShaFull: full,
      latestCommit: latestCommits.get(name) ?? null,
      children: [],
      parentName: name === defaultBranch ? null : parents.get(name)?.parent ?? defaultBranch,
      diverged: name === defaultBranch ? false : parents.get(name)?.diverged ?? false,
    });
  }

  for (const name of branchNames) {
    if (name === defaultBranch) continue;
    const node = nodeByName.get(name);
    if (!node || !node.parentName) continue;
    const parentNode = nodeByName.get(node.parentName);
    if (parentNode) parentNode.children.push(node);
  }

  // Alpha-sort children at every level
  function sortRec(n: BranchNode) {
    n.children.sort((a, b) => a.name.localeCompare(b.name));
    for (const c of n.children) sortRec(c);
  }
  const root = nodeByName.get(defaultBranch);
  if (root) sortRec(root);

  return (
    root ?? {
      name: defaultBranch,
      tipSha: "",
      tipShaFull: "",
      latestCommit: null,
      children: [],
      parentName: null,
      diverged: false,
    }
  );
}

async function fetchBranchGraph(
  token: string,
  owner: string,
  repo: string,
  defaultBranch: string
): Promise<BranchGraph | null> {
  const degraded: string[] = [];

  let branches: GhBranch[];
  let truncated: boolean;
  try {
    const listed = await listBranches(token, owner, repo, degraded);
    branches = listed.branches;
    truncated = listed.truncated;
  } catch {
    return null;
  }

  if (branches.length === 0) {
    return {
      root: {
        name: defaultBranch,
        tipSha: "",
        tipShaFull: "",
        latestCommit: null,
        children: [],
        parentName: null,
        diverged: false,
      },
      truncated: false,
      pairwise: false,
      degraded: ["branches"],
    };
  }

  const tipFullByName = new Map<string, string>();
  for (const b of branches) tipFullByName.set(b.name, b.commit.sha);

  if (!tipFullByName.has(defaultBranch)) {
    degraded.push("default-missing");
    // Synthesize a default entry so the tree has a root, even if empty.
    tipFullByName.set(defaultBranch, "");
  }

  const branchNames = Array.from(tipFullByName.keys());
  const nonDefaultBranches = branchNames.filter((n) => n !== defaultBranch);

  const latestCommits = await fetchTipCommits(token, owner, repo, branches, degraded);
  const tipDateByName = new Map<string, string>();
  for (const [name, c] of latestCommits.entries()) tipDateByName.set(name, c.date);

  const pairwise = branchNames.length <= PAIRWISE_CAP;

  let parents: Map<string, ParentInfo>;
  if (nonDefaultBranches.length === 0) {
    parents = new Map();
  } else if (pairwise) {
    const mb = await fetchPairwiseMergeBases(token, owner, repo, branchNames, degraded);
    parents = inferParentsPairwise(branchNames, defaultBranch, tipFullByName, tipDateByName, mb);
  } else {
    const mb = await fetchDefaultMergeBases(
      token,
      owner,
      repo,
      defaultBranch,
      nonDefaultBranches,
      degraded
    );
    parents = inferParentsFallback(branchNames, defaultBranch, tipFullByName, mb);
  }

  const root = buildNodes(branchNames, defaultBranch, tipFullByName, latestCommits, parents);

  return { root, truncated, pairwise, degraded };
}

export const buildBranchGraph = unstable_cache(
  fetchBranchGraph,
  ["branch-graph"],
  { revalidate: REVALIDATE_SECONDS }
);
