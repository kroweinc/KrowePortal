"use client";

/* "Download PDF" for a PRD. We print the rendered canonical document itself
   (window.print → "Save as PDF") rather than rasterizing it, so the PDF comes
   out identical to the on-screen view — real fonts, vector text, accent colors.
   The @media print rules in prd-document.css strip the page chrome and tune
   page breaks; on the builder dashboard, prd-dashboard.css isolates a hidden
   print-only copy of the document. We swap document.title around the call so
   the browser's Save-as-PDF dialog defaults to the PRD's name. */

import { Download } from "lucide-react";

interface Props {
  title: string;
  /** Visual style. Defaults to the standalone pill used on the public page;
      pass e.g. "prd-btn prd-btn--outline" to match a toolbar. */
  className?: string;
  label?: string;
}

export function PrdDownloadButton({ title, className = "prd-download-btn", label = "Download PDF" }: Props) {
  function handleDownload() {
    const previous = document.title;
    document.title = title?.trim() || "PRD";
    const restore = () => {
      document.title = previous;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.print();
  }

  return (
    <button type="button" className={`${className} prd-print-hide`} onClick={handleDownload}>
      <Download className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </button>
  );
}
