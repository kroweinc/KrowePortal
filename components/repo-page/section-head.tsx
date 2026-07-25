import type { LucideIcon } from "lucide-react";

interface SectionHeadProps {
  icon: LucideIcon;
  title: string;
}

/** The "◇ Overview" line that opens each section of the Repo page. */
export function SectionHead({ icon: Icon, title }: SectionHeadProps) {
  return (
    <div className="krowe-repo-section-head">
      <Icon size={13} strokeWidth={2} aria-hidden />
      <h2 className="krowe-repo-section-title">{title}</h2>
      <span className="krowe-repo-section-rule" aria-hidden />
    </div>
  );
}
