import { getAccountContext } from "@/lib/settings/account-context";
import { SecurityEditor } from "@/components/settings/security-editor";
import { SettingsHeader } from "@/components/settings/settings-section";

export const metadata = { title: "Security · Settings" };

export default async function BuilderSecurityPage() {
  const { email, isDevProfile, isPasswordUser } = await getAccountContext();

  return (
    <div className="krowe-set-stack">
      <SettingsHeader title="Security" sub="Your password and active sessions." />
      <SecurityEditor currentEmail={email} isPasswordUser={isPasswordUser} isDevProfile={isDevProfile} />
    </div>
  );
}
