import Link from "next/link";
import { getPrdByToken } from "@/lib/actions/prds-public";
import { PrdPublicView } from "./prd-public-view";

interface Props {
  params: Promise<{ token: string }>;
}

export default async function PublicPrdPage({ params }: Props) {
  const { token } = await params;

  if (!/^[a-f0-9]{64}$/.test(token)) {
    return <ErrorCard message="This PRD link is invalid." />;
  }

  // getPrdByToken already hides draft/rejected PRDs (returns null).
  const data = await getPrdByToken(token);
  if (!data) {
    return <ErrorCard message="This PRD isn't available." />;
  }

  return <PrdPublicView data={data} />;
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
