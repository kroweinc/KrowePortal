"use client";

/* Public client view for a shared PRD link. Mirrors the builder dashboard's
   Preview mode verbatim: a sticky section TOC on the left + a read-only section
   rail on the right, full-width — not the old centered 760px document. The
   polished canonical document is still rendered hidden + print-only so
   "Download PDF" produces the same editorial PDF as before. */

import { PrdRail } from "@/components/prd/dashboard/prd-rail";
import { PrdStatStrip } from "@/components/prd/dashboard/prd-stat-strip";
import { EditContext } from "@/components/prd/dashboard/inline-edit";
import { PrdDocument } from "@/components/prd/prd-document";
import { PrdDownloadButton } from "@/components/prd/prd-download-button";
import { DocSignPanel, DocSignedBanner } from "@/components/doc/doc-sign-panel";
import { PreparedBy } from "@/components/doc/prepared-by";
import { type PublicPrd } from "@/lib/actions/prds-public";
import { acceptAndSignPrd, rejectPrd } from "@/lib/actions/accept-doc";
import type { PrdContent } from "@/lib/types";
import "@/components/prd/dashboard/prd-dashboard.css";

/** The rail is read-only here, so edits never fire — patch is a no-op. */
const noopPatch = () => {};

export function PrdPublicView({
  data,
  viewer,
}: {
  data: PublicPrd;
  viewer: { isAuthenticated: boolean; viewerName: string };
}) {
  const { prd, builderName } = data;
  const content: PrdContent = prd.content ?? {};
  const isSigned = prd.status === "signed";

  return (
    <main className="prd-public">
      <div className="prd-dashboard">
        <div className="dash">
          <header className="dash-header">
            <div className="dash-header__actions">
              <PrdDownloadButton title={prd.title} className="prd-btn prd-btn--outline" />
            </div>
            <div className="dash-header__lead">
              <h1 className="dash-title dash-title--serif">{prd.title}</h1>
              <div className="dash-meta">
                <PreparedBy builder={data.builder} className="dash-updated" />
              </div>
            </div>
          </header>

          <PrdStatStrip content={content} />

          {/* editing:false renders every section block read-only (same as Preview mode). */}
          <EditContext.Provider value={{ editing: false }}>
            <div className="dash-grid">
              <PrdRail content={content} patch={noopPatch} />
            </div>
          </EditContext.Provider>

          <div className="prd-print-hide mx-auto max-w-2xl">
            {isSigned ? (
              <DocSignedBanner
                message="This PRD has been approved."
                signerName={prd.signed_by_name}
                signedAt={prd.signed_at}
              />
            ) : (
              <DocSignPanel
                token={prd.token}
                builderName={builderName}
                action={acceptAndSignPrd}
                onReject={rejectPrd}
                heading="Approve this PRD"
                consentText="I approve this product requirements document and consent to sign electronically. This approves the PRD prepared by"
                buttonLabel="Approve PRD"
                isAuthenticated={viewer.isAuthenticated}
                viewerName={viewer.viewerName}
                loginHref={`/login?next=${encodeURIComponent(`/prd/${prd.token}`)}`}
              />
            )}
          </div>
        </div>
      </div>

      {/* Hidden on screen; surfaced only when the client hits Download PDF, so the
          PDF stays the polished editorial document (unchanged from before). */}
      <div className="prd-doc-stage prd-print-only" aria-hidden="true">
        <div className="preview-stage">
          <div className="preview-doc">
            <header className="preview-head">
              <div className="preview-head__text">
                <p className="preview-eyebrow">Product Requirements Document</p>
                <h1 className="preview-title">{prd.title}</h1>
                <p className="preview-prepared">
                  Prepared by <span>{builderName}</span>
                </p>
              </div>
            </header>
            <div className="preview-card">
              <PrdDocument content={content} />
            </div>
            <p className="preview-footer">Powered by Krowe Portal</p>
          </div>
        </div>
      </div>
    </main>
  );
}
