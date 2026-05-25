"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "Tasks", href: "/b" },
  { label: "Project", href: "/b/github" },
];

interface BuilderTabsProps {
  taskCount?: number;
  engagementCount?: number;
}

export function BuilderTabs({ taskCount, engagementCount = 1 }: BuilderTabsProps) {
  const pathname = usePathname();

  return (
    <div className="krowe-tabsbar">
      <div className="krowe-tabs">
        {TABS.map((tab) => {
          const isActive =
            tab.href === "/b"
              ? pathname === "/b" || pathname.startsWith("/b/tasks")
              : pathname.startsWith(tab.href);

          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`krowe-tab ${isActive ? "active" : ""}`}
            >
              {tab.label}
              {tab.href === "/b" && taskCount !== undefined && (
                <span className="count">{taskCount}</span>
              )}
            </Link>
          );
        })}
      </div>
      <div className="krowe-tabsbar-meta">
        {engagementCount} engagement{engagementCount !== 1 ? "s" : ""} · synced just now
      </div>
    </div>
  );
}
