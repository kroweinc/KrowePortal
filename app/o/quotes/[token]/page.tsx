import { notFound, redirect } from "next/navigation";
import { getCurrentProfile, getAuthViewer } from "@/lib/auth";
import { getQuoteByToken } from "@/lib/actions/quote-docs-public";
import { QuotePublicView } from "@/app/quotes/[token]/quote-public-view";

export const metadata = { title: "Quote" };

// In-portal quote view for the operator. The standalone /quotes/[token] page is
// a sidebar-less public document; this route renders the same editorial view
// (download + accept/sign panel intact) inside the operator shell so a sent
// quote opens with the sidebar and chrome still in place. The engagement page
// links here for operators; the public token link stays for unauthenticated
// recipients.
export default async function OperatorQuotePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "operator") redirect("/b");

  const { token } = await params;
  if (!/^[a-f0-9]{64}$/.test(token)) notFound();

  // getQuoteByToken already hides draft/rejected quotes (returns null).
  const [data, viewer] = await Promise.all([getQuoteByToken(token), getAuthViewer()]);
  if (!data) notFound();

  return <QuotePublicView data={data} viewer={viewer} />;
}
