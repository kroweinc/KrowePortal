import type { ResolvedTechIcon } from "@/lib/builder-profile/tech-icons";

/**
 * Renders a single project tech tag as a rounded pill. When a resolved brand
 * icon is supplied (server-side, via `resolveTechBadges`), its official logo in
 * brand color is shown alongside the canonical name; otherwise the plain text
 * pill is rendered.
 *
 * This component is intentionally presentational and client-safe: the ~80-glyph
 * `simple-icons` table lives in the server-only `lib/builder-profile/tech-icons`
 * module so it never reaches the browser bundle. Pass `icon={null}` to render a
 * plain pill (e.g. in the builder's live editor, where tags are unsaved drafts).
 */
export function TechBadge({ tech, icon }: { tech: string; icon: ResolvedTechIcon | null }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-600">
      {icon && (
        <svg
          role="img"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="h-3 w-3 shrink-0"
          style={{ color: `#${icon.hex}` }}
          aria-hidden="true"
        >
          <path d={icon.path} />
        </svg>
      )}
      {icon ? icon.title : tech}
    </span>
  );
}
