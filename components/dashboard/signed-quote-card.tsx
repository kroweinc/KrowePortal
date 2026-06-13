import Link from "next/link";
import { FileSignature } from "lucide-react";
import type { Quote } from "@/lib/types";

function formatCurrency(amount: number): string {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function SignedQuoteCard({
  quote,
  contractToken,
  prdToken,
}: {
  quote: Quote;
  contractToken?: string | null;
  prdToken?: string | null;
}) {
  const grand = quote.content.totals?.grand ?? 0;

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileSignature className="h-4 w-4 text-neutral-500" />
          <h2 className="text-sm font-semibold text-neutral-900">Signed quote</h2>
        </div>
        <Link
          href={`/quotes/${quote.token}`}
          className="text-xs text-neutral-500 underline hover:text-neutral-900"
        >
          View quote
        </Link>
      </div>

      <p className="text-sm font-medium text-neutral-900">{quote.title}</p>

      <div className="mt-3 flex items-end justify-between">
        <div className="text-xs text-neutral-500">
          {quote.signed_by_name && quote.signed_at ? (
            <>
              Accepted by <span className="font-medium text-neutral-700">{quote.signed_by_name}</span>
              <br />
              {formatDate(quote.signed_at)}
            </>
          ) : (
            "Accepted"
          )}
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wide text-neutral-400">Total</div>
          <div className="text-lg font-semibold text-neutral-900">{formatCurrency(grand)}</div>
        </div>
      </div>

      {(contractToken || prdToken) && (
        <div className="mt-3 flex gap-4 border-t border-neutral-100 pt-3 text-xs">
          {contractToken && (
            <Link href={`/contract/${contractToken}`} className="text-neutral-500 underline hover:text-neutral-900">
              View signed contract
            </Link>
          )}
          {prdToken && (
            <Link href={`/prd/${prdToken}`} className="text-neutral-500 underline hover:text-neutral-900">
              View PRD
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
