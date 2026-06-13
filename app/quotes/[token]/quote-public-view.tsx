"use client";

/* Public client view for a shared quote link. Renders the polished, editorial
   "Product Quote Breakdown" document (the same one the PDF prints) plus a
   download button and the accept/sign panel. Mirrors the contract public view,
   reusing the generic DocSignPanel/DocSignedBanner. */

import { QuoteDocument } from "@/components/quote/quote-document";
import { PrdDownloadButton } from "@/components/prd/prd-download-button";
import { DocSignPanel, DocSignedBanner } from "@/components/doc/doc-sign-panel";
import { PreparedBy } from "@/components/doc/prepared-by";
import { type PublicQuote } from "@/lib/actions/quote-docs-public";
import { acceptAndSignQuote, rejectQuote } from "@/lib/actions/accept-doc";
import type { QuoteContent } from "@/lib/types";

export function QuotePublicView({
  data,
  viewer,
}: {
  data: PublicQuote;
  viewer: { isAuthenticated: boolean; viewerName: string };
}) {
  const { quote, builderName } = data;
  const content: QuoteContent = quote.content ?? {};
  const isSigned = quote.status === "signed" || quote.status === "accepted";
  const headerTitle = content.companyName || quote.title;

  return (
    <main className="prd-doc-stage">
      <div className="preview-stage">
        <div className="preview-doc">
          <header className="preview-head">
            <div className="preview-head__text">
              <p className="preview-eyebrow">Product Quote Breakdown</p>
              <h1 className="preview-title">{headerTitle}</h1>
              {content.productSubtitle && <p className="preview-prepared">{content.productSubtitle}</p>}
              <PreparedBy builder={data.builder} className="preview-prepared" />
            </div>
            <PrdDownloadButton title={quote.title} />
          </header>

          <div className="preview-card">
            <QuoteDocument content={content} />
          </div>

          <div className="prd-print-hide">
            {isSigned ? (
              <DocSignedBanner
                message="This quote has been accepted."
                signerName={quote.signed_by_name}
                signedAt={quote.signed_at}
              />
            ) : (
              <DocSignPanel
                token={quote.token}
                builderName={builderName}
                action={acceptAndSignQuote}
                onReject={rejectQuote}
                heading="Accept this quote"
                consentText="I accept this quote and its pricing, and consent to sign electronically. This accepts the quote prepared by"
                buttonLabel="Accept quote"
                isAuthenticated={viewer.isAuthenticated}
                viewerName={viewer.viewerName}
                loginHref={`/login?next=${encodeURIComponent(`/quotes/${quote.token}`)}`}
              />
            )}
          </div>

          <p className="preview-footer">Powered by Krowe Portal</p>
        </div>
      </div>
    </main>
  );
}
