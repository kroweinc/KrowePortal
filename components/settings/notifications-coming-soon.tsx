import { Bell } from "lucide-react";
import { SettingsSection } from "@/components/settings/settings-section";

/** Placeholder shown while notification preferences are not yet available.
    Rendered in place of NotificationPreferencesEditor on the builder and
    operator notifications settings pages. */
export function NotificationsComingSoon() {
  return (
    <SettingsSection title="Email notifications">
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
          <Bell size={18} strokeWidth={1.9} />
        </span>
        <p className="text-sm font-medium text-neutral-900">Coming soon</p>
        <p className="max-w-xs text-xs text-neutral-500">
          Notification preferences aren&apos;t available just yet. You&apos;ll be able to
          choose which emails Krowe sends you right here soon.
        </p>
      </div>
    </SettingsSection>
  );
}
