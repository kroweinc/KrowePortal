import { FileText, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RepoContext } from "@/lib/github/types";

interface ReadmePreviewProps {
  context: RepoContext;
}

export function ReadmePreview({ context }: ReadmePreviewProps) {
  const { readmeExcerpt, owner, repo, defaultBranch } = context;
  const readmeUrl = `https://github.com/${owner}/${repo}/blob/${defaultBranch}/README.md`;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-neutral-400" aria-hidden />
            README
          </CardTitle>
          <a
            href={readmeUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900"
          >
            View full README
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        </div>
      </CardHeader>
      <CardContent>
        {readmeExcerpt.trim() ? (
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-neutral-50 p-4 text-xs leading-relaxed text-neutral-700 font-mono">
            {readmeExcerpt}
          </pre>
        ) : (
          <p className="text-sm text-neutral-400">No README found in this repository.</p>
        )}
      </CardContent>
    </Card>
  );
}
