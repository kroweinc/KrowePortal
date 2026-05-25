import { GitBranch } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BranchNode, BranchGraph } from "@/lib/github/branches";

interface BranchesTreeProps {
  graph: BranchGraph;
  purposes: Record<string, string>;
  owner: string;
  repo: string;
}

interface BranchesTreeWithPurposesProps {
  graph: BranchGraph;
  purposesPromise: Promise<Record<string, string>>;
  owner: string;
  repo: string;
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function relativeTime(iso: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = then - Date.now();
  const diffMin = Math.round(diffMs / 60_000);
  const absMin = Math.abs(diffMin);
  if (absMin < 60) return rtf.format(diffMin, "minute");
  const diffHr = Math.round(diffMin / 60);
  if (Math.abs(diffHr) < 24) return rtf.format(diffHr, "hour");
  const diffDay = Math.round(diffHr / 24);
  if (Math.abs(diffDay) < 30) return rtf.format(diffDay, "day");
  const diffMonth = Math.round(diffDay / 30);
  if (Math.abs(diffMonth) < 12) return rtf.format(diffMonth, "month");
  return rtf.format(Math.round(diffMonth / 12), "year");
}

interface BranchRowProps {
  node: BranchNode;
  depth: number;
  owner: string;
  repo: string;
  purposes: Record<string, string>;
}

function BranchRow({ node, depth, owner, repo, purposes }: BranchRowProps) {
  const branchUrl = `https://github.com/${owner}/${repo}/tree/${encodeURIComponent(node.name)}`;
  const purpose = purposes[node.name];

  return (
    <li className="text-sm">
      <div
        className="flex items-center gap-2"
        style={{ paddingLeft: depth * 16 }}
      >
        {depth > 0 && (
          <span className="font-mono text-neutral-300" aria-hidden>
            └─
          </span>
        )}
        <a
          href={branchUrl}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-neutral-800 hover:text-neutral-900 hover:underline"
        >
          {node.name}
        </a>
        {node.tipSha && (
          <span className="font-mono text-xs text-neutral-400">{node.tipSha}</span>
        )}
        {node.diverged && (
          <span className="text-xs text-neutral-400 italic">diverged</span>
        )}
      </div>
      {purpose && (
        <p
          className="mt-0.5 text-sm text-neutral-600"
          style={{ paddingLeft: depth * 16 + (depth > 0 ? 24 : 0) }}
        >
          {purpose}
        </p>
      )}
      {node.latestCommit && (
        <p
          className="mt-0.5 truncate text-xs text-neutral-400"
          style={{ paddingLeft: depth * 16 + (depth > 0 ? 24 : 0) }}
        >
          <span className="truncate">{node.latestCommit.message}</span>
          {node.latestCommit.date && (
            <>
              <span className="px-1.5">·</span>
              <span>{relativeTime(node.latestCommit.date)}</span>
            </>
          )}
        </p>
      )}
      {node.children.length > 0 && (
        <ul className="mt-2 space-y-2">
          {node.children.map((child) => (
            <BranchRow
              key={child.name}
              node={child}
              depth={depth + 1}
              owner={owner}
              repo={repo}
              purposes={purposes}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function BranchesTree({ graph, purposes, owner, repo }: BranchesTreeProps) {
  const onlyDefault = graph.root.children.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-neutral-400" aria-hidden />
          Branches
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!graph.pairwise && (
          <p className="text-xs text-neutral-400 italic">
            Hierarchy inferred from default branch only (large branch count).
          </p>
        )}
        {graph.truncated && (
          <p className="text-xs text-neutral-400 italic">
            Showing first 200 branches.
          </p>
        )}
        <ul className="space-y-2">
          <BranchRow
            node={graph.root}
            depth={0}
            owner={owner}
            repo={repo}
            purposes={purposes}
          />
        </ul>
        {onlyDefault && (
          <p className="text-sm text-neutral-400">Only the default branch exists.</p>
        )}
        {graph.degraded.length > 0 && (
          <p className="text-xs text-neutral-400 italic">
            Some branch metadata unavailable.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export async function BranchesTreeWithPurposes({
  graph,
  purposesPromise,
  owner,
  repo,
}: BranchesTreeWithPurposesProps) {
  const purposes = await purposesPromise;
  return <BranchesTree graph={graph} purposes={purposes} owner={owner} repo={repo} />;
}

export function BranchesTreeSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-neutral-400 animate-pulse" aria-hidden />
          Branches
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="h-4 w-2/3 animate-pulse rounded bg-neutral-100" />
        <div className="h-3 w-5/6 animate-pulse rounded bg-neutral-100" />
        <div className="ml-6 h-4 w-1/2 animate-pulse rounded bg-neutral-100" />
        <div className="ml-6 h-3 w-3/4 animate-pulse rounded bg-neutral-100" />
        <div className="ml-12 h-4 w-2/5 animate-pulse rounded bg-neutral-100" />
      </CardContent>
    </Card>
  );
}

export function BranchesUnavailable() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-neutral-400" aria-hidden />
          Branches
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-neutral-500">Branch graph unavailable.</p>
      </CardContent>
    </Card>
  );
}
