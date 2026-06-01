import Link from "next/link";
import { FileSignature } from "lucide-react";
import type { Brief } from "@/lib/types";

function formatCurrency(amount: number): string {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function SignedQuoteCard({ brief }: { brief: Brief }) {
  const grand = brief.content.totals?.grand ?? 0;

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileSignature className="h-4 w-4 text-neutral-500" />
          <h2 className="text-sm font-semibold text-neutral-900">Signed quote</h2>
        </div>
        <Link
          href={`/quote/${brief.token}`}
          className="text-xs text-neutral-500 underline hover:text-neutral-900"
        >
          View quote
        </Link>
      </div>

      <p className="text-sm font-medium text-neutral-900">{brief.title}</p>

      <div className="mt-3 flex items-end justify-between">
        <div className="text-xs text-neutral-500">
          {brief.signed_by_name && brief.signed_at ? (
            <>
              Signed by <span className="font-medium text-neutral-700">{brief.signed_by_name}</span>
              <br />
              {formatDate(brief.signed_at)}
            </>
          ) : (
            "Signed"
          )}
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wide text-neutral-400">Total</div>
          <div className="text-lg font-semibold text-neutral-900">{formatCurrency(grand)}</div>
        </div>
      </div>

      {brief.content.paymentTerms && (
        <p className="mt-3 border-t border-neutral-100 pt-3 text-xs text-neutral-500">
          {brief.content.paymentTerms}
        </p>
      )}
    </div>
  );
}
