import { Bell } from "lucide-react";
import { SettingsSection } from "@/components/settings/settings-section";

/** Placeholder shown while notification preferences are not yet available.
    Rendered in place of NotificationPreferencesEditor on the builder and
    operator notifications settings pages. */
export function NotificationsComingSoon() {
  return (
    <SettingsSection title="Email notifications">
      <div className="krowe-set-empty">
        <span className="krowe-set-empty-ic">
          <Bell size={18} strokeWidth={1.9} />
        </span>
        <p className="krowe-set-empty-title">Coming soon</p>
        <p className="krowe-set-empty-body">
          Notification preferences aren&apos;t available just yet. You&apos;ll be able to
          choose which emails Krowe sends you right here soon.
        </p>
      </div>
    </SettingsSection>
  );
}
