import type { LucideIcon } from "lucide-react";

// One section of the profile editor: glyph + serif title + hint, an optional
// right-aligned header action ("Add new project"), and the card holding the
// section's content. The id feeds both the tab nav's scrollIntoView and the
// scroll-spy IntersectionObserver in profile-setup.tsx.
export function ProfileSection({
  id,
  icon: Icon,
  title,
  hint,
  actions,
  children,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  hint?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="ss-sec" id={`sec-${id}`}>
      <div className="sh">
        <span className="medallion">
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
