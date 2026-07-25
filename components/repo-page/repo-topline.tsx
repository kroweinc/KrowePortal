import Link from "next/link";
import { CodeXml, Github, ArrowUpRight, Settings } from "lucide-react";

interface RepoToplineProps {
  title: string;
  repoUrl: string;
}

/**
 * The bar directly beneath the topbar: what repo you're looking at and the one
 * way out of the app. Full-bleed, so it renders outside the .krowe-page shell.
 */
export function RepoTopline({ title, repoUrl }: RepoToplineProps) {
  return (
    <div className="krowe-repo-topline">
      <div className="krowe-repo-topline-main">
        <span className="krowe-repo-glyph" aria-hidden>
          <CodeXml size={20} strokeWidth={1.75} />
        </span>

        <h1 className="krowe-repo-title">{title}</h1>
      </div>

      <div className="krowe-repo-topline-actions">
        <a href={repoUrl} target="_blank" rel="noreferrer" className="krowe-repo-gh">
          <Github size={14} strokeWidth={2} aria-hidden />
          Open on GitHub
          <ArrowUpRight size={8} strokeWidth={3} aria-hidden />
        </a>

        <Link href="/b/settings/github" className="krowe-repo-settings">
          <Settings size={14} strokeWidth={2} aria-hidden />
          GitHub settings
        </Link>
      </div>
    </div>
  );
}
