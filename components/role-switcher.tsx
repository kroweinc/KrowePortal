"use client";

import { useRouter } from "next/navigation";
import { ROLE_SWITCHER_ENABLED } from "@/lib/auth-shared";
import { useActiveRole } from "@/lib/role-context";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/types";

const ROLES: Role[] = ["builder", "operator"];

export function RoleSwitcher() {
  const router = useRouter();
  const activeRole = useActiveRole();

  if (!ROLE_SWITCHER_ENABLED || !activeRole) return null;

  async function switchTo(role: Role) {
    if (role === activeRole) return;
    await fetch("/api/dev/role", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    router.refresh();
  }

  return (
    <div
      className="flex items-center gap-0.5 rounded-md border border-amber-200 bg-amber-50 p-0.5"
      title="Dev only — switch role view"
    >
      {ROLES.map((r) => (
        <button
          key={r}
          onClick={() => switchTo(r)}
          className={cn(
            "rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors",
            r === activeRole
              ? "bg-white text-neutral-900 shadow-sm"
              : "text-amber-700 hover:text-amber-900"
          )}
        >
          {r}
        </button>
      ))}
    </div>
  );
}
