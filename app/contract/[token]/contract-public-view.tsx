"use client";

/* Public client view for a shared contract link. Renders the polished services
   agreement (the same one the PDF prints) — including the snapshotted Scope of
   Work + Payment Schedule exhibits — plus a download button and the accept/sign
   panel. Mirrors quote-public-view.tsx, reusing the generic DocSignPanel. */

import { ContractDocument } from "@/components/contract/contract-document";
import { useTodayISODate } from "@/lib/contract/use-today";
import { PrdDownloadButton } from "@/components/prd/prd-download-button";
import { DocSignPanel, DocSignedBanner } from "@/components/doc/doc-sign-panel";
import { PreparedBy } from "@/components/doc/prepared-by";
import { type PublicContract } from "@/lib/actions/contracts-public";
import { acceptAndSignContract, rejectContract } from "@/lib/actions/accept-doc";
import type { ContractContent } from "@/lib/types";

export function ContractPublicView({
  data,
  viewer,
}: {
  data: PublicContract;
  viewer: { isAuthenticated: boolean; viewerName: string };
}) {
  const { contract, builderName } = data;
  const content: ContractContent = contract.content ?? {};
  const isSigned = contract.status === "signed";
  // Floats to today only for a not-yet-sent draft; sent/signed show the frozen date.
  const today = useTodayISODate();
  const effectiveDate = contract.status === "draft" ? today : content.effectiveDate ?? null;
  // Legal party name from the contract itself; shown alongside the builder's
  // profile identity only when it names someone else (e.g. a company).
  const providerName = content.parties?.provider;

  return (
    <main className="prd-doc-stage">
      <div className="preview-stage">
        <div className="preview-doc">
          <header className="preview-head">
            <div className="preview-head__text">
              <p className="preview-eyebrow">Services Agreement</p>
              <h1 className="preview-title">{contract.title}</h1>
              <PreparedBy builder={data.builder} className="preview-prepared" />
              {providerName && providerName !== data.builder.name && (
                <p className="preview-prepared">
                  On behalf of <span>{providerName}</span>
                </p>
              )}
            </div>
            <PrdDownloadButton title={contract.title} />
          </header>

          <div className="preview-card">
            <ContractDocument content={content} effectiveDate={effectiveDate} />
          </div>

          <div className="prd-print-hide">
            {isSigned ? (
              <DocSignedBanner
                message="This contract has been signed."
                signerName={contract.signed_by_name}
                signedAt={contract.signed_at}
              />
            ) : (
              <DocSignPanel
                token={contract.token}
                builderName={builderName}
                action={acceptAndSignContract}
                onReject={rejectContract}
                heading="Accept &amp; sign this contract"
                consentText="I agree to the terms in this agreement, and consent to sign electronically. This signature executes the agreement with"
                buttonLabel="Sign contract"
                isAuthenticated={viewer.isAuthenticated}
                viewerName={viewer.viewerName}
                loginHref={`/login?next=${encodeURIComponent(`/contract/${contract.token}`)}`}
              />
            )}
          </div>

          <p className="preview-footer">Powered by Krowe Portal</p>
        </div>
      </div>
    </main>
  );
}
