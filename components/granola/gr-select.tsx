"use client";

import { ChevronDown } from "lucide-react";

/* Styled select from the Build Board design (.sel-wrap): optional leading
   adornment (icon / priority swatch), custom chevron, and priority tones. */
export function GrSelect({
  value,
  onChange,
  options,
  size = "sm",
  leading,
  tone,
  disabled,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  size?: "sm" | "lg";
  leading?: React.ReactNode;
  tone?: "urgent" | "high" | "medium" | "low";
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <span
      className={`krowe-gr-sel sel-${size}${leading ? " has-lead" : ""}${tone ? ` tone-${tone}` : ""}`}
    >
      {leading && <span className="lead">{leading}</span>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={ariaLabel}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="chev">
        <ChevronDown size={size === "lg" ? 16 : 14} strokeWidth={2} />
      </span>
    </span>
  );
}
