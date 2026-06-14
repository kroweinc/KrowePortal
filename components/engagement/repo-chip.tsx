import { GitBranch, Github } from "lucide-react";
import "./engagement.css";

/* The connected GitHub repo as a mono chip, or a muted "No repo linked" chip.
   Shared by the list card and the Manage hero. */
export function RepoChip({ repo }: { repo?: string | null }) {
  if (repo) {
    return (
      <span className="eng-chip mono">
        <span className="ci">
          <Github size={13} strokeWidth={1.75} />
        </span>
        {repo}
      </span>
    );
  }
  return (
    <span className="eng-chip">
      <span className="ci">
        <GitBranch size={13} strokeWidth={1.75} />
      </span>
      No repo linked
    </span>
  );
}
