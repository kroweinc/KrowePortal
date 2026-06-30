import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { Ember } from "@/components/design-atoms";
import { SettingsNav, type SettingsNavItem } from "@/components/settings/settings-nav";

const BUILDER_SETTINGS_NAV: SettingsNavItem[] = [
  { label: "Account", href: "/b/settings", icon: "user-round", exact: true },
  { label: "Security", href: "/b/settings/security", icon: "shield" },
  { label: "Notifications", href: "/b/settings/notifications", icon: "bell" },
  { label: "Quote Defaults", href: "/b/settings/quotes", icon: "receipt" },
  { label: "GitHub", href: "/b/settings/github", icon: "github" },
];

export const metadata = { title: "Settings" };

export default async function BuilderSettingsLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") redirect("/o");

  return (
    <main className="krowe-page">
      <div className="krowe-page-inner max-w-5xl space-y-6">
        <div className="krowe-page-head">
          <div>
            <h1 className="krowe-page-title">
              <Ember size={22} /> Settings
            </h1>
            <div className="krowe-page-sub">
              <span style={{ fontStyle: "italic", textTransform: "none", letterSpacing: "normal" }}>
                Manage your account and connections.
              </span>
            </div>
          </div>
        </div>

        <div className="krowe-settings-shell">
          <SettingsNav items={BUILDER_SETTINGS_NAV} />
          <div className="krowe-settings-content">{children}</div>
        </div>
      </div>
    </main>
  );
}
