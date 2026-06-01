import Link from "next/link";
import { getQuoteByToken } from "@/lib/actions/quotes-public";
import { QuotePublicView } from "./quote-public-view";

interface Props {
  params: Promise<{ token: string }>;
}

export default async function PublicQuotePage({ params }: Props) {
  const { token } = await params;

  if (!/^[a-f0-9]{64}$/.test(token)) {
    return <ErrorCard message="This quote link is invalid." />;
  }

  const quote = await getQuoteByToken(token);
  if (!quote) {
    return <ErrorCard message="This quote link is invalid." />;
  }

  // Don't leak drafts (not yet sent) or rejected quotes on the public link.
  if (quote.brief.status === "draft") {
    return <ErrorCard message="This quote isn't available yet." />;
  }
  if (quote.brief.status === "rejected") {
    return <ErrorCard message="This quote is no longer available." />;
  }

  return <QuotePublicView quote={quote} />;
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
