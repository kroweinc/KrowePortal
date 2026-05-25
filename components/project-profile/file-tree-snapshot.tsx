import { Folder, FileCode2, FolderTree } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RepoContext } from "@/lib/github/types";

interface FileTreeSnapshotProps {
  context: RepoContext;
}

export function FileTreeSnapshot({ context }: FileTreeSnapshotProps) {
  const { topLevelTree } = context;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FolderTree className="h-4 w-4 text-neutral-400" aria-hidden />
          Project structure
        </CardTitle>
      </CardHeader>
      <CardContent>
        {topLevelTree.length === 0 ? (
          <p className="text-sm text-neutral-400">Tree unavailable.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {topLevelTree.map((entry) => {
              const isDir = entry.endsWith("/");
              const Icon = isDir ? Folder : FileCode2;
              return (
                <li
                  key={entry}
                  className="flex items-center gap-2 rounded px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50"
                >
                  <Icon
                    className={`h-3.5 w-3.5 shrink-0 ${
                      isDir ? "text-sky-500" : "text-neutral-400"
                    }`}
                    aria-hidden
                  />
                  <span className="font-mono text-xs">{entry}</span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
