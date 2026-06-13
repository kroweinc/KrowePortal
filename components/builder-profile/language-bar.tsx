import type { RepoLanguage } from "@/lib/types";

// Stable, readable palette for the top-5 language split.
const COLORS = ["#f97316", "#0ea5e9", "#8b5cf6", "#10b981", "#f43f5e"];

export function LanguageBar({ languages }: { languages: RepoLanguage[] }) {
  if (!languages || languages.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
        {languages.map((lang, i) => (
          <div
            key={lang.name}
            style={{ width: `${lang.pct}%`, backgroundColor: COLORS[i % COLORS.length] }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-neutral-500">
        {languages.map((lang, i) => (
          <span key={lang.name} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: COLORS[i % COLORS.length] }}
            />
            {lang.name} {lang.pct}%
          </span>
        ))}
      </div>
    </div>
  );
}
