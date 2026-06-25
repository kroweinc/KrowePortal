import type { Metadata } from "next";
import { getBuilderProfileByToken } from "@/lib/actions/builder-profile-public";
import { getShareLinkState } from "@/lib/actions/share-links";
import { ShareLinkError } from "@/components/share-link/share-link-error";
import { PublicProfileView } from "@/components/builder-profile/public-profile-view";

interface Props {
  params: Promise<{ token: string }>;
}

// Share links are capability URLs — keep them out of search engines.
export const metadata: Metadata = {
  title: "Profile",
  robots: { index: false, follow: false },
};

export default async function PublicBuilderProfilePage({ params }: Props) {
  const { token } = await params;

  if (!/^[a-f0-9]{64}$/.test(token)) {
    return <ShareLinkError state="not-found" noun="profile" />;
  }

  // getBuilderProfileByToken already hides unpublished/expired/revoked (returns
  // null); on the null path, classify the token so we can show why.
  const data = await getBuilderProfileByToken(token);
  if (!data) {
    const state = await getShareLinkState("builder_profiles", token);
    return <ShareLinkError state={state} noun="profile" />;
  }

  return <PublicProfileView data={data} token={token} />;
}
