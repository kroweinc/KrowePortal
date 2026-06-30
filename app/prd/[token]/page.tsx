import { getPrdByToken } from "@/lib/actions/prds-public";
import { getShareLinkState } from "@/lib/actions/share-links";
import { getAuthViewer } from "@/lib/auth";
import { ShareLinkError } from "@/components/share-link/share-link-error";
import { PrdPublicView } from "./prd-public-view";

interface Props {
  params: Promise<{ token: string }>;
}

export const metadata = { title: "PRD" };

export default async function PublicPrdPage({ params }: Props) {
  const { token } = await params;

  if (!/^[a-f0-9]{64}$/.test(token)) {
    return <ShareLinkError state="not-found" noun="PRD" />;
  }

  // getPrdByToken already hides draft/rejected/expired/revoked (returns null);
  // on the null path, classify the token so we can show why (expired vs invalid).
  const [data, viewer] = await Promise.all([getPrdByToken(token), getAuthViewer()]);
  if (!data) {
    const state = await getShareLinkState("prds", token);
    return <ShareLinkError state={state} noun="PRD" />;
  }

  return <PrdPublicView data={data} viewer={viewer} />;
}
