import { getNotificationPreferences } from "@/lib/actions/notification-preferences";
import { NotificationPreferencesEditor } from "@/components/settings/notification-preferences-editor";
import { SettingsHeader } from "@/components/settings/settings-section";

export const metadata = { title: "Notifications · Settings" };

export default async function OperatorNotificationsPage() {
  const prefs = await getNotificationPreferences();

  return (
    <div className="space-y-5">
      <SettingsHeader title="Notifications" sub="Choose which emails Krowe sends you." />
      <NotificationPreferencesEditor initial={prefs} />
    </div>
  );
}
