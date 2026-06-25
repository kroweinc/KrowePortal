import { getContractByToken } from "@/lib/actions/contracts-public";
import { getShareLinkState } from "@/lib/actions/share-links";
import { getAuthViewer } from "@/lib/auth";
import { ShareLinkError } from "@/components/share-link/share-link-error";
import { ContractPublicView } from "./contract-public-view";

interface Props {
  params: Promise<{ token: string }>;
}

export const metadata = { title: "Contract" };

export default async function PublicContractPage({ params }: Props) {
  const { token } = await params;

  if (!/^[a-f0-9]{64}$/.test(token)) {
    return <ShareLinkError state="not-found" noun="contract" />;
  }

  // getContractByToken already hides draft/rejected/expired/revoked (returns null);
  // on the null path, classify the token so we can show why (expired vs invalid).
  const [data, viewer] = await Promise.all([getContractByToken(token), getAuthViewer()]);
  if (!data) {
    const state = await getShareLinkState("contracts", token);
    return <ShareLinkError state={state} noun="contract" />;
  }

  return <ContractPublicView data={data} viewer={viewer} />;
}
