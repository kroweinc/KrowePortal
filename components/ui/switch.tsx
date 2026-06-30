"use client";

/* Minimal, dependency-free toggle switch styled with Krowe CSS variables.
   Controlled: pass `checked` + `onCheckedChange`. Renders an accessible
   role="switch" button. Mirrors the inline-style approach in confirm-dialog.tsx
   so it inherits the design tokens without new Tailwind config. */

import * as React from "react";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  disabled = false,
  id,
  ...aria
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={aria["aria-label"]}
      aria-labelledby={aria["aria-labelledby"]}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className="relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        background: checked ? "var(--primary)" : "var(--border-strong)",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <span
        aria-hidden="true"
        className="inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform"
        style={{ transform: checked ? "translateX(18px)" : "translateX(2px)" }}
      />
    </button>
  );
}
