import { Bell } from "lucide-react";
import { DEV_TOGGLE_ENABLED } from "@/lib/auth";
import { GlobalSearch } from "@/components/global-search";
import { TourHelpButton } from "@/components/tour/tour-help-button";
import type { Profile } from "@/lib/types";

interface NavProps {
  profile: Profile;
}

/** First + last word initials, e.g. "Dev Builder" → "DB". */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Nav({ profile }: NavProps) {
  const role = profile.role;
  const displayName = profile.display_name ?? "—";

  return (
    <header className="krowe-topbar">
      <GlobalSearch role={role} />

      <div className="krowe-topbar-right">
        {/* Dev role switcher — sits immediately left of the help (?) icon. */}
        {DEV_TOGGLE_ENABLED && (
          <form action="/api/dev/role" method="POST">
            <input
              type="hidden"
              name="role"
              value={role === "operator" ? "builder" : "operator"}
            />
            <button type="submit" className="krowe-view-switch">
              view as {role === "operator" ? "builder" : "operator"}
            </button>
          </form>
        )}

        <TourHelpButton />
        <button type="button" className="krowe-tb-icon" title="Notifications">
          <Bell size={18} />
        </button>

        <div className="krowe-tb-profile">
          <span className="avatar">{initials(displayName)}</span>
          <div className="who">
            <div className="nm">{displayName}</div>
            <div className="rl">{role}</div>
          </div>
        </div>
      </div>
    </header>
  );
}
