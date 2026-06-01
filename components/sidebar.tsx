"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { KroweLogo } from "@/components/krowe-logo";

interface SidebarTab {
  label: string;
  href: string;
}

interface SidebarProps {
  tabs: SidebarTab[];
  /** Base route ("/o" or "/b") used to resolve active state for the tasks root. */
  basePath: string;
}

export function Sidebar({ tabs, basePath }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="krowe-sidebar">
      <div className="krowe-sidebar-brand">
        <KroweLogo priority />
        <span className="krowe-brand-portal">Portal</span>
      </div>

      <nav className="krowe-sidebar-nav">
        {tabs.map((tab) => {
          const isActive =
            tab.href === basePath
              ? pathname === basePath || pathname.startsWith(`${basePath}/tasks`)
              : pathname.startsWith(tab.href);

          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`krowe-sidebar-link ${isActive ? "active" : ""}`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
