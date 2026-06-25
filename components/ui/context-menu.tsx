"use client";

/* Reusable right-click context menu primitive.

   • useContextMenu() owns open/close state and exposes two open paths:
     - openAtEvent(e)  → opens at the cursor (right-click / onContextMenu)
     - openAtAnchor(el) → opens anchored below a trigger element (the ⋯ kebab)
   • <ContextMenu> portals into <body>, flips back inside the viewport when it
     would overflow, and closes on outside-click, Escape, scroll, and resize.

   Menu contents are data-driven via the MenuItem[] passed in, so every surface
   (doc rows, context items, engagement cards, task cards) shares one component
   and only differs in its item list. */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import "./context-menu.css";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void | Promise<void>;
  /** Red styling for dangerous actions (delete). */
  destructive?: boolean;
  /** Greyed, non-selectable — e.g. delete on a non-draft doc. */
  disabled?: boolean;
  /** Tooltip shown when the item is disabled. */
  disabledReason?: string;
  /** Render a divider above this item. */
  separatorBefore?: boolean;
}

type Point = { x: number; y: number };

// useLayoutEffect warns during SSR; fall back to useEffect on the server. The
// menu only ever opens client-side, so behaviour is identical.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function useContextMenu() {
  const [state, setState] = useState<Point | null>(null);

  const openAtEvent = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setState({ x: e.clientX, y: e.clientY });
  }, []);

  const openAtAnchor = useCallback((el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setState({ x: r.right, y: r.bottom + 4 });
  }, []);

  const close = useCallback(() => setState(null), []);

  return { state, openAtEvent, openAtAnchor, close, isOpen: state !== null };
}

export function ContextMenu({
  state,
  items,
  onClose,
}: {
  state: Point | null;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<Point | null>(null);

  // Position after open, nudging back inside the viewport if the menu would
  // overflow its right/bottom edge. useLayoutEffect runs before paint, so the
  // pre-measure render (visibility:hidden) never flashes.
  useIsoLayoutEffect(() => {
    if (!state) {
      setCoords(null);
      return;
    }
    const el = ref.current;
    if (!el) {
      setCoords(state);
      return;
    }
    const m = el.getBoundingClientRect();
    const pad = 8;
    let { x, y } = state;
    if (x + m.width > window.innerWidth - pad) x = window.innerWidth - m.width - pad;
    if (y + m.height > window.innerHeight - pad) y = window.innerHeight - m.height - pad;
    setCoords({ x: Math.max(pad, x), y: Math.max(pad, y) });
  }, [state]);

  // Dismissal: outside-click, Escape, and any scroll/resize that would strand
  // the menu away from its anchor.
  useEffect(() => {
    if (!state) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [state, onClose]);

  if (!state) return null;

  return createPortal(
    <div
      ref={ref}
      className="ctx-menu"
      role="menu"
      style={{
        top: coords?.y ?? state.y,
        left: coords?.x ?? state.x,
        visibility: coords ? "visible" : "hidden",
      }}
    >
      {items.map((it, i) => (
        <div key={i}>
          {it.separatorBefore && <div className="ctx-sep" />}
          <button
            type="button"
            role="menuitem"
            className={`ctx-item${it.destructive ? " is-destructive" : ""}`}
            disabled={it.disabled}
            title={it.disabled ? it.disabledReason : undefined}
            onClick={() => {
              onClose();
              void it.onSelect();
            }}
          >
            {it.icon && <span className="ctx-ico">{it.icon}</span>}
            {it.label}
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
}
