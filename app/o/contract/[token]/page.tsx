import { notFound, redirect } from "next/navigation";
import { getCurrentProfile, getAuthViewer } from "@/lib/auth";
import { getContractByToken } from "@/lib/actions/contracts-public";
import { ContractPublicView } from "@/app/contract/[token]/contract-public-view";

export const metadata = { title: "Contract" };

// In-portal contract view for the operator. The standalone /contract/[token]
// page is a sidebar-less public document; this route renders the same editorial
// view (download + accept/sign panel intact) inside the operator shell so a sent
// contract opens with the sidebar and chrome still in place. The engagement page
// links here for operators; the public token link stays for unauthenticated
// recipients.
export default async function OperatorContractPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "operator") redirect("/b");

  const { token } = await params;
  if (!/^[a-f0-9]{64}$/.test(token)) notFound();

  // getContractByToken already hides draft/rejected contracts (returns null).
  const [data, viewer] = await Promise.all([getContractByToken(token), getAuthViewer()]);
  if (!data) notFound();

  return <ContractPublicView data={data} viewer={viewer} />;
}
