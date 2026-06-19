import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { Ember } from "@/components/design-atoms";
import { SettingsNav, type SettingsNavItem } from "@/components/settings/settings-nav";

const OPERATOR_SETTINGS_NAV: SettingsNavItem[] = [
  { label: "Account", href: "/o/settings", icon: "user-round", exact: true },
  { label: "Security", href: "/o/settings/security", icon: "shield" },
  { label: "Notifications", href: "/o/settings/notifications", icon: "bell" },
];

export const metadata = { title: "Settings" };

export default async function OperatorSettingsLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "operator") redirect("/b");

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
                Manage your account.
              </span>
            </div>
          </div>
        </div>

        <div className="krowe-settings-shell">
          <SettingsNav items={OPERATOR_SETTINGS_NAV} />
          <div className="krowe-settings-content">{children}</div>
        </div>
      </div>
    </main>
  );
}
