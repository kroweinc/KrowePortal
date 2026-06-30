import { getAccountContext } from "@/lib/settings/account-context";
import { SecurityEditor } from "@/components/settings/security-editor";
import { SettingsHeader } from "@/components/settings/settings-section";

export const metadata = { title: "Security · Settings" };

export default async function OperatorSecurityPage() {
  const { email, isDevProfile, isPasswordUser } = await getAccountContext();

  return (
    <div className="space-y-5">
      <SettingsHeader title="Security" sub="Your password and active sessions." />
      <SecurityEditor currentEmail={email} isPasswordUser={isPasswordUser} isDevProfile={isDevProfile} />
    </div>
  );
}
