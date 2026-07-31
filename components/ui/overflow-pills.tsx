"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";

/* ============================================================
   OverflowPills — a pill row that fits itself to one line.

   Renders as many pills as actually fit in the space it's given,
   then rolls the remainder into a "+X more" chip that opens a
   dropdown holding them. Any pill row that can outgrow its
   container should use this instead of wrapping to a second line.

   How the fit is measured: a hidden probe renders every pill at
   its natural width, so we fit against real widths rather than
   guessing from character counts. A ResizeObserver watches BOTH
   the row (container resized) and the probe (pill contents or the
   web font changed, which moves widths without moving the row).

   The row must be able to grow into a stable width — it's
   `flex: 1 1 0%` — otherwise shrinking it to fit would shrink the
   space we measure against, and the fit would cascade to zero.
   That's also why `pinned` is measured off the real element
   rather than a probe copy: one element, one measurement, and no
   duplicated interactive controls in the tree.
   ============================================================ */

export interface OverflowPill {
  key: string;
  /** The pill itself. Rendered in the row, or in the overflow menu. */
  node: React.ReactNode;
}

export function OverflowPills({
  items,
  pinned,
  gap = 7,
  className,
  label,
}: {
  items: OverflowPill[];
  /** Trailing control that never collapses (e.g. the agent hub's "Edit" chip). */
  pinned?: React.ReactNode;
  /** Row gap in px. Applied to the probe too, so measurement matches render. */
  gap?: number;
  className?: string;
  /** Names what's collapsing, for the "+X more" button's accessible label. */
  label?: string;
}) {
  const rowRef = React.useRef<HTMLDivElement>(null);
  const probeRef = React.useRef<HTMLDivElement>(null);
  const pinnedRef = React.useRef<HTMLDivElement>(null);
  const [visible, setVisible] = React.useState(items.length);
  const [open, setOpen] = React.useState(false);

  const count = items.length;

  // Deps are primitives only: `items` and `pinned` are fresh objects on every
  // parent render, and depending on them would rebuild the ResizeObserver each
  // time. Content changes that move widths are caught by observing the probe.
  const fit = React.useCallback(() => {
    const row = rowRef.current;
    const probe = probeRef.current;
    if (!row || !probe) return;

    // offsetWidth, NOT getBoundingClientRect(): the rect is post-transform, and
    // this row lives inside a command palette that opens on a scale() animation.
    // Measuring mid-animation made every pill read ~1.5% narrow against an
    // untransformed clientWidth, so everything "fit" and the row silently
    // overflowed — and ResizeObserver, which reports untransformed sizes, never
    // fired to correct it. offsetWidth is layout-based, like clientWidth.
    const widths = Array.from(probe.children).map((k) => (k as HTMLElement).offsetWidth);
    const itemW = widths.slice(0, count);
    const moreW = widths[count] ?? 0;
    const pinnedW = pinnedRef.current?.offsetWidth ?? 0;
    const avail = row.clientWidth - (pinnedW ? pinnedW + gap : 0);

    // What a row showing `n` pills costs, including the "+X more" chip it needs
    // whenever anything is left over.
    const widthFor = (n: number) => {
      const parts = itemW.slice(0, n);
      if (n < count) parts.push(moreW);
      if (!parts.length) return 0;
      return parts.reduce((a, b) => a + b, 0) + gap * (parts.length - 1);
    };

    let next = count;
    if (widthFor(count) > avail) {
      // Nothing fits → 0 pills and a "+X more" that carries the whole row.
      next = 0;
      for (let n = count - 1; n > 0; n--) {
        if (widthFor(n) <= avail) {
          next = n;
          break;
        }
      }
    }
    setVisible((cur) => (cur === next ? cur : next));
    // The row grew enough to show everything — the button anchoring the menu is
    // about to unmount. Drop the menu with it, so it can't spring back open on
    // its own the next time the row narrows.
    if (next >= count) setOpen(false);
  }, [count, gap]);

  React.useLayoutEffect(() => {
    fit();
    const row = rowRef.current;
    const probe = probeRef.current;
    if (!row || !probe || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    ro.observe(row);
    ro.observe(probe);
    return () => ro.disconnect();
  }, [fit]);

  // Escape closes the dropdown before anything upstream sees it — without the
  // capture-phase stop, the command palette hosting this row would close too.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  const overflow = items.slice(visible);

  return (
    <div ref={rowRef} className={`krowe-op${className ? ` ${className}` : ""}`} style={{ gap }}>
      {items.slice(0, visible).map((it) => (
        <React.Fragment key={it.key}>{it.node}</React.Fragment>
      ))}

      {overflow.length > 0 && (
        <div className="krowe-op-wrap">
          <button
            type="button"
            className="krowe-op-more"
            onClick={() => setOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={
              label
                ? `Show ${overflow.length} more ${label}`
                : `Show ${overflow.length} more`
            }
          >
            +{overflow.length} more
            <ChevronDown size={12} className="krowe-op-chev" />
          </button>
          {open && (
            <>
              <div className="krowe-op-scrim" onClick={() => setOpen(false)} />
              <div className="krowe-op-menu" role="menu">
                {overflow.map((it) => (
                  <React.Fragment key={it.key}>{it.node}</React.Fragment>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {pinned && (
        <div ref={pinnedRef} className="krowe-op-pinned">
          {pinned}
        </div>
      )}

      {/* Every pill at natural width + the widest "+X more" the row could need.
          Hidden from paint, pointers, and assistive tech — it exists only to be
          measured. Static content only: it renders each pill a second time, so
          anything interactive would be duplicated. */}
      <div className="krowe-op-probe-clip" aria-hidden="true">
        <div ref={probeRef} className="krowe-op-probe" style={{ gap }}>
          {items.map((it) => (
            <React.Fragment key={it.key}>{it.node}</React.Fragment>
          ))}
          <span className="krowe-op-more">
            +{count} more
            <ChevronDown size={12} className="krowe-op-chev" />
          </span>
        </div>
      </div>
    </div>
  );
}
