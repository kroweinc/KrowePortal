import { getAccountContext } from "@/lib/settings/account-context";
import { AccountEditor } from "@/components/settings/account-editor";
import { SettingsHeader } from "@/components/settings/settings-section";

export const metadata = { title: "Account · Settings" };

export default async function BuilderAccountPage() {
  const { profile, email, isDevProfile } = await getAccountContext();

  return (
    <div className="space-y-5">
      <SettingsHeader title="Account" sub="Your name, email, and account details." />
      <AccountEditor
        initialName={profile.display_name ?? ""}
        currentEmail={email}
        role={profile.role}
        memberSince={profile.created_at}
        isDevProfile={isDevProfile}
      />
    </div>
  );
}
