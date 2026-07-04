import { NotificationsComingSoon } from "@/components/settings/notifications-coming-soon";
import { SettingsHeader } from "@/components/settings/settings-section";

export const metadata = { title: "Notifications · Settings" };

export default function BuilderNotificationsPage() {
  return (
    <div className="krowe-set-stack">
      <SettingsHeader title="Notifications" sub="Choose which emails Krowe sends you." />
      <NotificationsComingSoon />
    </div>
  );
}
