"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FeedbackDialog } from "@/components/feedback-dialog";
import { assetUrl } from "@/lib/asset-url";
import {
  ListChecks,
  Briefcase,
  GitBranch,
  FileText,
  UserRound,
  Settings,
  FolderKanban,
  LogOut,
  ChevronLeft,
  type LucideIcon,
} from "lucide-react";

const COLLAPSE_KEY = "krowe:sidebar-collapsed";

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

  // Collapsed state persists in localStorage so the icon-only rail survives
  // reloads and page navigation. Hydrate after mount to avoid an SSR mismatch;
  // the `ready` flag gates the width transition so the stored state paints
  // instantly on first load rather than animating open.
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* private mode / storage disabled — stay expanded */
    }
  }, []);
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });

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
        title={tab.label}
        className={`krowe-sidebar-link ${isActive ? "active" : ""}`}
      >
        <span className="krowe-sidebar-ic">
          <Icon size={17} strokeWidth={1.9} />
        </span>
        <span className="krowe-sidebar-label">{tab.label}</span>
      </Link>
    );
  };

  return (
    <aside
      className={`krowe-sidebar ${collapsed ? "collapsed" : ""} ${mounted ? "ready" : ""}`}
    >
      <div className="krowe-sidebar-brand">
        {/* Intrinsic dimensions (493×506) reserve the logo's space before load to
            avoid CLS; CSS (.krowe-sidebar-brand img) scales it to height:26px. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={assetUrl("/KroweIcon.png")} alt="Krowe" width={493} height={506} />
        <span className="krowe-sidebar-word">Krowe</span>
        <button
          type="button"
          className="krowe-sidebar-toggle"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <ChevronLeft size={16} strokeWidth={2} />
        </button>
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
            title="Sign out"
          >
            <span className="krowe-sidebar-ic">
              <LogOut size={17} strokeWidth={1.9} />
            </span>
            <span className="krowe-sidebar-label">Sign out</span>
          </button>
        </form>
      </div>
    </aside>
  );
}
