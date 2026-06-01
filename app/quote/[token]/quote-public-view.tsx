import { BriefView } from "@/components/brief/brief-view";
import { SignPanel } from "./sign-panel";
import type { PublicQuote } from "@/lib/actions/quotes-public";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function QuotePublicView({ quote }: { quote: PublicQuote }) {
  const { brief, builderName } = quote;
  const isSigned = brief.status === "signed" || brief.status === "accepted";

  return (
    <main className="min-h-screen bg-neutral-50 py-10 px-4">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-6">
          <p className="text-xs uppercase tracking-wide text-neutral-400">Proposal &amp; Statement of Work</p>
          <h1 className="mt-1 text-2xl font-semibold text-neutral-900">{brief.title}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Prepared by <span className="font-medium text-neutral-700">{builderName}</span>
          </p>
        </header>

        <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
          <BriefView content={brief.content} />
        </div>

        {isSigned ? (
          <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-center">
            <p className="text-sm font-medium text-emerald-900">This quote has been signed.</p>
            {brief.signed_by_name && brief.signed_at && (
              <p className="mt-1 text-xs text-emerald-700">
                Signed by {brief.signed_by_name} on {formatDateTime(brief.signed_at)}
              </p>
            )}
            <p className="mt-2 text-xs text-emerald-700">
              Your workspace is being set up — {builderName} will be in touch.
            </p>
          </div>
        ) : (
          <SignPanel token={brief.token} builderName={builderName} />
        )}

        <p className="mt-6 text-center text-xs text-neutral-400">
          Powered by Krowe Portal
        </p>
      </div>
    </main>
  );
}
