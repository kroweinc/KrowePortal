import { getQuoteByToken } from "@/lib/actions/quote-docs-public";
import { getShareLinkState } from "@/lib/actions/share-links";
import { getAuthViewer } from "@/lib/auth";
import { ShareLinkError } from "@/components/share-link/share-link-error";
import { QuotePublicView } from "./quote-public-view";

interface Props {
  params: Promise<{ token: string }>;
}

export const metadata = { title: "Quote" };

export default async function PublicQuotePage({ params }: Props) {
  const { token } = await params;

  if (!/^[a-f0-9]{64}$/.test(token)) {
    return <ShareLinkError state="not-found" noun="quote" />;
  }

  // getQuoteByToken already hides draft/rejected/expired/revoked (returns null);
  // on the null path, classify the token so we can show why (expired vs invalid).
  const [data, viewer] = await Promise.all([getQuoteByToken(token), getAuthViewer()]);
  if (!data) {
    const state = await getShareLinkState("quotes", token);
    return <ShareLinkError state={state} noun="quote" />;
  }

  return <QuotePublicView data={data} viewer={viewer} />;
}
