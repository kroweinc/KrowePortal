import type { LucideIcon } from "lucide-react";

// One Smart Scroll section: a medallion + serif title + hint header above a
// white card holding the section's editor. `accent` gives the Tags section its
// warm canvas; `clay` paints the medallion in the brand orange.
export function ProfileSection({
  id,
  icon: Icon,
  title,
  hint,
  clay = false,
  accent = false,
  actions,
  children,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  hint?: string;
  clay?: boolean;
  accent?: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={`ss-sec${accent ? " accent" : ""}`} id={`sec-${id}`}>
      <div className="sh">
        <span className={`medallion${clay ? " clay" : ""}`}>
          <Icon />
        </span>
        <div className="tt">
          <h2>{title}</h2>
          {hint && <p>{hint}</p>}
        </div>
        {actions && <div className="sh-actions">{actions}</div>}
      </div>
      <div className="ss-card">{children}</div>
    </section>
  );
}
