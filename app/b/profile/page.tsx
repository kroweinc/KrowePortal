import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { getOrCreateBuilderProfile } from "@/lib/actions/builder-profile";
import { Ember } from "@/components/design-atoms";
import { ProfileEditor } from "@/components/builder-profile/profile-editor";
import { ProfileViewToggle } from "@/components/builder-profile/profile-view-toggle";

export default async function BuilderProfilePage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") redirect("/o");

  const bundle = await getOrCreateBuilderProfile();
  if (!bundle) redirect("/b");

  return (
    <main className="krowe-page">
      <div className="krowe-page-inner max-w-3xl space-y-6">
        <div className="krowe-page-head">
          <div>
            <h1 className="krowe-page-title">
              <Ember size={22} /> Profile
            </h1>
            <div className="krowe-page-sub">
              <span style={{ fontStyle: "italic", textTransform: "none", letterSpacing: "normal" }}>
                A shareable resume of your work — send it to clients.
              </span>
            </div>
          </div>
        </div>

        <ProfileViewToggle>
          <ProfileEditor bundle={bundle} displayName={profile.display_name ?? "Builder"} />
        </ProfileViewToggle>
      </div>
    </main>
  );
}
