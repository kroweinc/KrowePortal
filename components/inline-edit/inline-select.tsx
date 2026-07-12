"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

const VARIANT_CLASSES: Record<string, string> = {
  low: "bg-green-50 text-green-700",
  medium: "bg-amber-50 text-amber-700",
  high: "bg-red-50 text-red-700",
  inbox: "bg-blue-50 text-blue-700",
  in_progress: "bg-amber-50 text-amber-700",
  blocked: "bg-red-50 text-red-700",
  done: "bg-green-50 text-green-700",
  // Task type override (feature/bug/change) mirrors the .krowe-chip-type colors.
  feature: "bg-green-50 text-green-700",
  bug: "bg-red-50 text-red-700",
  change: "bg-blue-50 text-blue-700",
  secondary: "bg-neutral-100 text-neutral-700",
};

export interface SelectOption {
  value: string;
  label: string;
}

interface InlineSelectProps {
  value: string;
  options: SelectOption[];
  onSave: (value: string) => Promise<void>;
  readOnly?: boolean;
  label?: string;
  className?: string;
}

export function InlineSelect({
  value,
  options,
  onSave,
  readOnly,
  label,
  className,
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

  const colorClass = VARIANT_CLASSES[localValue] ?? "bg-neutral-100 text-neutral-700";
  const currentLabel = options.find((o) => o.value === localValue)?.label ?? localValue;

  const badgeBase =
    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium";

  if (readOnly) {
    return (
      <span className="flex items-center gap-1">
        {label && <span>{label}:</span>}
        <span className={cn(badgeBase, colorClass, className)}>{currentLabel}</span>
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1">
      {label && <span>{label}:</span>}
      {/* Outer span sizes to the invisible label; select fills it absolutely */}
      <span className={cn("relative inline-flex", colorClass, "rounded-full", className)}>
        <span
          aria-hidden
          className="invisible select-none px-2.5 py-0.5 text-xs font-medium whitespace-nowrap"
        >
          {currentLabel}
        </span>
        <select
          value={localValue}
          onChange={handleChange}
          className={cn(
            "absolute inset-0 w-full h-full rounded-full",
            colorClass,
            "appearance-none cursor-pointer border-0 bg-transparent focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:ring-offset-1 hover:opacity-80 transition-opacity text-xs font-medium text-center"
          )}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </span>
    </span>
  );
}
