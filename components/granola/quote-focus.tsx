"use client";

import { useEffect } from "react";

/**
 * Lands the reader on the transcript line the task they arrived from came out
 * of. Renders nothing — the transcript itself stays server-rendered, so a
 * two-thousand-line call costs no hydration.
 *
 * Moving focus, not just scrolling, is the point: a keyboard or screen-reader
 * user who follows "From meeting" should continue from the quoted line, not
 * from the top of the document.
 */
export function QuoteFocus({ targetId }: { targetId: string | null }) {
  useEffect(() => {
    if (!targetId) return;
    const row = document
      .getElementById(targetId)
      ?.closest<HTMLElement>(".krowe-mtg-line");
    if (!row) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    // preventScroll so focus doesn't fight the scroll that just started.
    row.focus({ preventScroll: true });
  }, [targetId]);

  return null;
}
