import { PrdDocument } from "@/components/prd/prd-document";
import { type PublicPrd } from "@/lib/actions/prds-public";
import { PrdDownloadButton } from "@/components/prd/prd-download-button";

export function PrdPublicView({ data }: { data: PublicPrd }) {
  const { prd, builderName } = data;

  return (
    <main className="prd-doc-stage">
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
            <PrdDownloadButton title={prd.title} />
          </header>

          <div className="preview-card">
            <PrdDocument content={prd.content} />
          </div>

          <p className="preview-footer">Powered by Krowe Portal</p>
        </div>
      </div>
    </main>
  );
}
