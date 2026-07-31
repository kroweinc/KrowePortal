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

/** Open the browser's print / Save-as-PDF dialog for a PRD, with the document
    title swapped in so the dialog defaults to the PRD's name. Shared with the
    builder dashboard's Options menu, which offers the same action. */
export function printPrd(title: string) {
  const previous = document.title;
  document.title = title?.trim() || "PRD";
  const restore = () => {
    document.title = previous;
    window.removeEventListener("afterprint", restore);
  };
  window.addEventListener("afterprint", restore);
  window.print();
}

export function PrdDownloadButton({ title, className = "prd-download-btn", label = "Download PDF" }: Props) {
  return (
    <button type="button" className={`${className} prd-print-hide`} onClick={() => printPrd(title)}>
      <Download className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </button>
  );
}
