import { notFound, redirect } from "next/navigation";
import { getCurrentProfile, getAuthViewer } from "@/lib/auth";
import { getPrdByToken } from "@/lib/actions/prds-public";
import { PrdPublicView } from "@/app/prd/[token]/prd-public-view";

export const metadata = { title: "PRD" };

// In-portal PRD view for the operator. The standalone /prd/[token] page is a
// sidebar-less public document; this route renders the same editorial view
// (download + accept/sign panel intact) inside the operator shell so a sent PRD
// opens with the sidebar and chrome still in place. The engagement page links
// here for operators; the public token link stays for unauthenticated
// recipients.
export default async function OperatorPrdPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "operator") redirect("/b");

  const { token } = await params;
  if (!/^[a-f0-9]{64}$/.test(token)) notFound();

  // getPrdByToken already hides draft/rejected PRDs (returns null).
  const [data, viewer] = await Promise.all([getPrdByToken(token), getAuthViewer()]);
  if (!data) notFound();

  return <PrdPublicView data={data} viewer={viewer} />;
}
