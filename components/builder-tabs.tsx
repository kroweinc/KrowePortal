"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const TABS = [
  { label: "Tasks", href: "/b" },
  { label: "GitHub", href: "/b/github" },
]

export function BuilderTabs() {
  const pathname = usePathname()

  return (
    <div className="border-b border-neutral-200 bg-white">
      <div className="mx-auto max-w-6xl px-6">
        <nav className="flex">
          {TABS.map((tab) => {
            const isActive =
              tab.href === "/b"
                ? pathname === "/b" || pathname.startsWith("/b/tasks")
                : pathname.startsWith(tab.href)

            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  isActive
                    ? "border-neutral-900 text-neutral-900"
                    : "border-transparent text-neutral-400 hover:text-neutral-700"
                }`}
              >
                {tab.label}
              </Link>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
