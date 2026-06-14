import type { ReactNode } from "react";
import "./engagement.css";

/* A Manage-view section card: an iconed header (36px rounded icon tile + title +
   hint) over its body. `tone="danger"` paints the icon tile warm-red for the
   delete section. Body content (existing settings/documents/repo/delete
   components) is passed as children unchanged. */
export function EngagementSection({
  icon,
  title,
  hint,
  tone = "default",
  children,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  tone?: "default" | "danger";
  children: ReactNode;
}) {
  return (
    <section className={tone === "danger" ? "eng-section danger" : "eng-section"}>
      <div className="section-head">
        <span className="section-ic">{icon}</span>
        <div className="section-titles">
          <div className="section-title">{title}</div>
          {hint && <div className="section-hint">{hint}</div>}
        </div>
      </div>
      {children}
    </section>
  );
}
