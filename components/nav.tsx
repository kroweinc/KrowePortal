import Image from "next/image";
import { DEV_TOGGLE_ENABLED } from "@/lib/auth";
import type { Profile } from "@/lib/types";

interface NavProps {
  profile: Profile;
}

export function Nav({ profile }: NavProps) {
  const role = profile.role;
  const displayName = profile.display_name ?? "—";

  return (
    <header className="krowe-topbar">
      <div className="krowe-brand">
        <Image
          src="/images/KroweLogo.png"
          alt="Krowe"
          width={96}
          height={26}
          style={{ objectFit: "contain" }}
          priority
        />
        <span className="krowe-brand-portal">Portal</span>
      </div>
      <div className="krowe-topbar-right">
        <span className={`krowe-role-pill ${role}`}>
          <span className="dot" />
          {role}
        </span>
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
        <span className="krowe-user-name">{displayName}</span>
        <form action="/api/auth/logout" method="POST">
          <button type="submit" className="krowe-signout">Sign out</button>
        </form>
      </div>
    </header>
  );
}
