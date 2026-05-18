import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { RoleSwitcher } from "@/components/role-switcher";
import type { Profile } from "@/lib/types";

interface NavProps {
  profile: Profile;
}

export function Nav({ profile }: NavProps) {
  return (
    <header className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <Link href="/" className="text-sm font-semibold tracking-tight text-neutral-900">
          Krowe Portal
        </Link>
        <div className="flex items-center gap-4">
          <Badge variant={profile.role === "operator" ? "operator" : "builder"}>
            {profile.role}
          </Badge>
          <RoleSwitcher />
          <span className="text-sm text-neutral-500">
            {profile.display_name ?? "—"}
          </span>
          <form action="/api/auth/logout" method="POST">
            <button
              type="submit"
              className="text-xs text-neutral-400 hover:text-neutral-700 transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
