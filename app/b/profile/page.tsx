import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { getOrCreateBuilderProfile } from "@/lib/actions/builder-profile";
import { ProfileDraftProvider } from "@/components/builder-profile/profile-draft-context";
import { ProfileSetup } from "@/components/builder-profile/profile-setup";

export const metadata = { title: "Profile" };

export default async function BuilderProfilePage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") redirect("/o");

  const bundle = await getOrCreateBuilderProfile();
  if (!bundle) redirect("/b");

  const accountDisplayName = profile.display_name ?? "Builder";

  // Smart Scroll layout (direction C). The draft provider seeds from the bundle
  // and drives autosave, the strength meter, and the side live-preview drawer.
  return (
    <main className="ppsetup">
      <ProfileDraftProvider bundle={bundle} accountDisplayName={accountDisplayName}>
        <ProfileSetup />
      </ProfileDraftProvider>
    </main>
  );
}
