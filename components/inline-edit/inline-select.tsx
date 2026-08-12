"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

export interface SelectOption {
  value: string;
  label: string;
}

/** How the picker presents itself in a property row.
 *  - `bare` — the select is the value: borderless until the row is hovered.
 *  - `chip` — `face` is the value (a real chip, icon and all) and the select
 *    sits transparently over it, so editing costs the row no extra furniture. */
type InlineSelectVariant = "bare" | "chip";

interface InlineSelectProps {
  value: string;
  options: SelectOption[];
  onSave: (value: string) => Promise<void>;
  readOnly?: boolean;
  /** Accessible name — the property row's key isn't tied to the control. */
  label?: string;
  variant?: InlineSelectVariant;
  /** The visible value for `chip`; also what a read-only viewer sees. */
  face?: React.ReactNode;
}

export function InlineSelect({
  value,
  options,
  onSave,
  readOnly,
  label,
  variant = "bare",
  face,
}: InlineSelectProps) {
  const [localValue, setLocalValue] = useState(value);
  const [, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newValue = e.target.value;
    setLocalValue(newValue);
    if (newValue === value) return;
    startTransition(async () => {
      await onSave(newValue);
      router.refresh();
    });
  }

  const currentLabel = options.find((o) => o.value === localValue)?.label ?? localValue;

  if (readOnly) return <>{variant === "chip" ? face : currentLabel}</>;

  const select = (
    <select
      className={variant === "bare" ? "krowe-prop-sel" : undefined}
      value={localValue}
      onChange={handleChange}
      aria-label={label}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );

  if (variant === "chip") {
    return (
      <span className="krowe-prop-pick">
        {face}
        {select}
      </span>
    );
  }

  return select;
}
