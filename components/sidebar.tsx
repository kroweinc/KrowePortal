"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FeedbackDialog } from "@/components/feedback-dialog";
import {
  ListChecks,
  Briefcase,
  GitBranch,
  FileText,
  UserRound,
  Settings,
  FolderKanban,
  LogOut,
  type LucideIcon,
} from "lucide-react";

// Tabs are defined in Server Component layouts, so the icon must travel as a
// serializable string key (component refs can't cross the server→client seam).
const ICONS: Record<string, LucideIcon> = {
  "list-checks": ListChecks,
  briefcase: Briefcase,
  "git-branch": GitBranch,
  "file-text": FileText,
  "user-round": UserRound,
  settings: Settings,
  "folder-kanban": FolderKanban,
};

interface SidebarTab {
  label: string;
  href: string;
  /** lucide-react icon key (see ICONS map). */
  icon: string;
  /** Optional product-tour anchor key, emitted as data-tour on the link. */
  tour?: string;
}

interface SidebarProps {
  tabs: SidebarTab[];
  /** Base route ("/o" or "/b") used to resolve active state for the tasks root. */
  basePath: string;
}

export function Sidebar({ tabs, basePath }: SidebarProps) {
  const pathname = usePathname();

  // Settings sits at the bottom of the sidebar (just above Sign out), so pull
  // it out of the main nav flow rather than rendering it inline with the rest.
  const settingsTab = tabs.find((tab) => tab.icon === "settings");
  const navTabs = tabs.filter((tab) => tab.icon !== "settings");

  const renderLink = (tab: SidebarTab) => {
    const Icon = ICONS[tab.icon] ?? ListChecks;
    const isActive =
      tab.href === basePath
        ? pathname === basePath || pathname.startsWith(`${basePath}/tasks`)
        : pathname.startsWith(tab.href);

    return (
      <Link
        key={tab.href}
        href={tab.href}
        data-tour={tab.tour}
        className={`krowe-sidebar-link ${isActive ? "active" : ""}`}
      >
        <span className="krowe-sidebar-ic">
          <Icon size={17} strokeWidth={1.9} />
        </span>
        {tab.label}
      </Link>
    );
  };

  return (
    <aside className="krowe-sidebar">
      <div className="krowe-sidebar-brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/KroweIcon.png" alt="Krowe" />
        <span className="krowe-sidebar-word">Krowe</span>
      </div>

      <div className="krowe-sidebar-cap">Workspace</div>

      <nav className="krowe-sidebar-nav">{navTabs.map(renderLink)}</nav>

      <div className="krowe-sidebar-foot">
        <FeedbackDialog />
        {settingsTab && renderLink(settingsTab)}
        <form action="/api/auth/logout" method="POST">
          <button
            type="submit"
            className="krowe-sidebar-link krowe-sidebar-signout"
          >
            <span className="krowe-sidebar-ic">
              <LogOut size={17} strokeWidth={1.9} />
            </span>
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
