import Link from "next/link";
import { getContractByToken } from "@/lib/actions/contracts-public";
import { getAuthViewer } from "@/lib/auth";
import { ContractPublicView } from "./contract-public-view";

interface Props {
  params: Promise<{ token: string }>;
}

export default async function PublicContractPage({ params }: Props) {
  const { token } = await params;

  if (!/^[a-f0-9]{64}$/.test(token)) {
    return <ErrorCard message="This contract link is invalid." />;
  }

  // getContractByToken already hides draft/rejected contracts (returns null).
  const [data, viewer] = await Promise.all([getContractByToken(token), getAuthViewer()]);
  if (!data) {
    return <ErrorCard message="This contract isn't available." />;
  }

  return <ContractPublicView data={data} viewer={viewer} />;
}

function ErrorCard({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm text-center">
        <p className="text-sm text-neutral-500">{message}</p>
        <Link href="/" className="mt-4 inline-block text-sm text-neutral-700 underline">
          Go home
        </Link>
      </div>
    </main>
  );
}
