import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { getOwnProfilePreview } from "@/lib/actions/builder-profile-public";
import { PublicProfileView } from "@/components/builder-profile/public-profile-view";

// Owner-only preview — keep it out of search engines like the share links.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function ProfilePreviewPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") redirect("/o");

  const result = await getOwnProfilePreview();
  if (!result) redirect("/b/profile");

  return <PublicProfileView data={result.profile} token={result.token} />;
}
