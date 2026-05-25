import { GitCommit } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RepoContext } from "@/lib/github/types";

interface RecentCommitsListProps {
  context: RepoContext;
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function relativeTime(iso: string): string {
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

export function RecentCommitsList({ context }: RecentCommitsListProps) {
  const { recentCommits, owner, repo } = context;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitCommit className="h-4 w-4 text-neutral-400" aria-hidden />
          Recent commits
        </CardTitle>
      </CardHeader>
      <CardContent>
        {recentCommits.length === 0 ? (
          <p className="text-sm text-neutral-400">No recent commits available.</p>
        ) : (
          <ol className="space-y-3">
            {recentCommits.map((c) => (
              <li key={c.sha} className="flex items-start gap-3 text-sm">
                <a
                  href={`https://github.com/${owner}/${repo}/commit/${c.sha}`}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 font-mono text-xs text-neutral-500 hover:text-neutral-900"
                >
                  {c.sha}
                </a>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-neutral-800">{c.message}</p>
                  <p className="mt-0.5 text-xs text-neutral-400">{relativeTime(c.date)}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
