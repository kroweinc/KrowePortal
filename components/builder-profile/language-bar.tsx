import type { RepoLanguage } from "@/lib/types";

// Stable, readable palette for the top-5 language split.
const COLORS = ["#f97316", "#0ea5e9", "#8b5cf6", "#10b981", "#f43f5e"];

// Shared by the profile editor and the public page, so it carries its own
// token-based styles rather than inheriting either surface's conventions.
export function LanguageBar({ languages }: { languages: RepoLanguage[] }) {
  if (!languages || languages.length === 0) return null;

  return (
    <div className="krowe-langbar">
      <div className="bar">
        {languages.map((lang, i) => (
          <span
            key={lang.name}
            style={{ width: `${lang.pct}%`, backgroundColor: COLORS[i % COLORS.length] }}
          />
        ))}
      </div>
      <div className="legend">
        {languages.map((lang, i) => (
          <span key={lang.name}>
            <i style={{ backgroundColor: COLORS[i % COLORS.length] }} />
            {lang.name} {lang.pct}%
          </span>
        ))}
      </div>
    </div>
  );
}
