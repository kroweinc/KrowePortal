"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  UserRound,
  ShieldCheck,
  Bell,
  Receipt,
  Github,
  NotebookPen,
  Blocks,
  type LucideIcon,
} from "lucide-react";

// Icons travel as serializable string keys because the nav items are defined in
// Server Component layouts (component refs can't cross the server→client seam),
// mirroring components/sidebar.tsx.
const ICONS: Record<string, LucideIcon> = {
  "user-round": UserRound,
  shield: ShieldCheck,
  bell: Bell,
  receipt: Receipt,
  github: Github,
  "notebook-pen": NotebookPen,
  blocks: Blocks,
};

export interface SettingsNavItem {
  label: string;
  href: string;
  icon: string;
  /** When true, the link is active only on an exact path match (used for the
      index route, which is a prefix of every sub-route). */
  exact?: boolean;
}

export function SettingsNav({ items }: { items: SettingsNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="krowe-settings-nav" aria-label="Settings sections">
      {items.map((item) => {
        const Icon = ICONS[item.icon] ?? UserRound;
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`krowe-settings-nav-link ${active ? "active" : ""}`}
          >
            <span className="krowe-settings-nav-ic">
              <Icon size={16} strokeWidth={1.9} />
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
