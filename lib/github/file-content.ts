import { unstable_cache } from "next/cache";
import { githubFetch } from "./client";
import { NotFoundError } from "./types";

const MAX_FILE_BYTES = 50_000;

const TEXT_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "json", "jsonc",
  "md", "mdx", "txt", "rst",
  "css", "scss", "sass", "less",
  "html", "htm", "xml", "svg",
  "py", "rb", "go", "rs", "java", "kt", "swift", "c", "cc", "cpp", "h", "hpp", "cs", "php",
  "yml", "yaml", "toml", "ini", "cfg", "conf", "env",
  "sh", "bash", "zsh", "fish",
  "sql", "graphql", "gql", "prisma",
  "lock",
  "vue", "svelte", "astro",
  "dockerfile", "gitignore", "gitattributes", "editorconfig", "eslintrc", "prettierrc",
]);

const SPECIAL_TEXT_FILENAMES = new Set([
  "Dockerfile", "Makefile", "LICENSE", "README", "CHANGELOG", "CONTRIBUTING",
  ".gitignore", ".gitattributes", ".editorconfig", ".env.example", ".nvmrc",
]);

function isLikelyTextFile(path: string): boolean {
  const base = path.split("/").pop() ?? path;
  if (SPECIAL_TEXT_FILENAMES.has(base)) return true;
  const dot = base.lastIndexOf(".");
  if (dot === -1) return false;
  const ext = base.slice(dot + 1).toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

export type DirEntry = {
  name: string;
  path: string;
  type: "file" | "dir";
  size: number;
};

export type FileContentResult =
  | { ok: true; content: string; truncated: boolean; sha: string; size: number }
  | { ok: false; reason: string };

type GhContentsItem = {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: "file" | "dir" | "symlink" | "submodule";
  content?: string;
  encoding?: string;
};

async function fetchDirectoryListing(
  token: string,
  owner: string,
  repo: string,
  ref: string,
  path: string
): Promise<DirEntry[]> {
  const cleanPath = path.replace(/^\/+/, "").replace(/\/+$/, "");
  const endpoint = cleanPath
    ? `/repos/${owner}/${repo}/contents/${encodeURI(cleanPath)}?ref=${encodeURIComponent(ref)}`
    : `/repos/${owner}/${repo}/contents?ref=${encodeURIComponent(ref)}`;

  const data = await githubFetch<GhContentsItem | GhContentsItem[]>(endpoint, token);

  if (!Array.isArray(data)) {
    throw new Error(`Path "${path}" is a file, not a directory. Use read_file instead.`);
  }

  return data
    .filter((item) => item.type === "file" || item.type === "dir")
    .map((item) => ({
      name: item.name,
      path: item.path,
      type: item.type as "file" | "dir",
      size: item.size,
    }));
}

async function fetchFileContent(
  token: string,
  owner: string,
  repo: string,
  ref: string,
  path: string
): Promise<FileContentResult> {
  const cleanPath = path.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!cleanPath) {
    return { ok: false, reason: "Empty path." };
  }

  if (!isLikelyTextFile(cleanPath)) {
    return {
      ok: false,
      reason: `Refusing to read "${cleanPath}" — looks like a binary or unsupported file type.`,
    };
  }

  const endpoint = `/repos/${owner}/${repo}/contents/${encodeURI(cleanPath)}?ref=${encodeURIComponent(ref)}`;

  let data: GhContentsItem | GhContentsItem[];
  try {
    data = await githubFetch<GhContentsItem | GhContentsItem[]>(endpoint, token);
  } catch (err) {
    if (err instanceof NotFoundError) {
      return { ok: false, reason: `File not found: ${cleanPath}` };
    }
    throw err;
  }

  if (Array.isArray(data)) {
    return { ok: false, reason: `Path "${cleanPath}" is a directory, not a file.` };
  }

  if (data.type !== "file") {
    return { ok: false, reason: `Path "${cleanPath}" is a ${data.type}, not a regular file.` };
  }

  if (data.encoding !== "base64" || typeof data.content !== "string") {
    return {
      ok: false,
      reason: `File "${cleanPath}" is too large (${data.size} bytes) — GitHub did not return inline content.`,
    };
  }

  let decoded: string;
  try {
    decoded = Buffer.from(data.content, "base64").toString("utf-8");
  } catch {
    return { ok: false, reason: `Failed to decode "${cleanPath}".` };
  }

  const truncated = decoded.length > MAX_FILE_BYTES;
  const content = truncated
    ? decoded.slice(0, MAX_FILE_BYTES) + `\n\n…[truncated at ${MAX_FILE_BYTES} chars of ${decoded.length}]`
    : decoded;

  return {
    ok: true,
    content,
    truncated,
    sha: data.sha,
    size: data.size,
  };
}

type GhCodeSearchItem = {
  path: string;
  text_matches?: { fragment: string }[];
};
type GhCodeSearchResponse = {
  total_count: number;
  items: GhCodeSearchItem[];
};

async function fetchCodeSearch(
  token: string,
  owner: string,
  repo: string,
  query: string
): Promise<{ totalCount: number; results: { path: string; fragment: string }[] }> {
  const q = `${query} repo:${owner}/${repo}`;
  const endpoint = `/search/code?q=${encodeURIComponent(q)}&per_page=10`;

  const data = await githubFetch<GhCodeSearchResponse>(endpoint, token);

  return {
    totalCount: data.total_count,
    results: (data.items ?? []).slice(0, 10).map((item) => ({
      path: item.path,
      fragment: item.text_matches?.[0]?.fragment?.slice(0, 400) ?? "",
    })),
  };
}

export const listDirectoryContents = unstable_cache(
  fetchDirectoryListing,
  ["github-dir-listing"],
  { revalidate: 3600 }
);

export const readFileContent = unstable_cache(
  fetchFileContent,
  ["github-file-content"],
  { revalidate: 3600 }
);

export const searchCode = unstable_cache(
  fetchCodeSearch,
  ["github-code-search"],
  { revalidate: 600 }
);
