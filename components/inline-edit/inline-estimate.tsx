"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatHoursRange } from "@/lib/format-estimate";

interface InlineEstimateProps {
  low: number | null;
  high: number | null;
  /** The stored midpoint (builder_estimate_hours); also the value we edit from. */
  fallback: number | null;
  onSave: (hours: number) => Promise<void>;
  readOnly?: boolean;
  className?: string;
  placeholder?: string;
}

/**
 * Reads as the AI estimate range ("3–5h") but edits down to a single hours
 * value. A manual edit collapses the range — the server sets low = high =
 * midpoint — so what you type is what the cell shows next.
 */
export function InlineEstimate({
  low,
  high,
  fallback,
  onSave,
  readOnly,
  className,
  placeholder = "—",
}: InlineEstimateProps) {
  // Optimistic override: the just-saved value, shown the instant you hit Enter
  // so the cell doesn't wait on the server round-trip + router.refresh().
  const [pending, setPending] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const wasPending = useRef(false);
  const router = useRouter();

  const serverCurrent =
    fallback ?? (low != null && high != null ? (low + high) / 2 : null);
  // The optimistic value wins until the write settles; then the refreshed props
  // are authoritative (and correctly revert the cell if the save failed).
  const current = pending ?? serverCurrent;
  const label =
    pending != null
      ? formatHoursRange(pending, pending, pending)
      : formatHoursRange(low, high, fallback);

  const [draft, setDraft] = useState(current != null ? String(current) : "");

  // Drop the override the moment the transition finishes — props now reflect
  // the truth, so there's nothing left to override.
  useEffect(() => {
    if (wasPending.current && !isPending) setPending(null);
    wasPending.current = isPending;
  }, [isPending]);

  useEffect(() => {
    if (!editing) setDraft(current != null ? String(current) : "");
  }, [current, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function save() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed === "") return;
    const hours = Number(trimmed);
    if (!Number.isFinite(hours) || hours < 0) return;
    if (hours === current) return;
    setPending(hours);
    startTransition(async () => {
      await onSave(hours);
      router.refresh();
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      setDraft(current != null ? String(current) : "");
      setEditing(false);
    }
  }

  if (readOnly) {
    return (
      <span className={cn(label ? "" : "muted", className)}>
        {label ?? placeholder}
      </span>
    );
  }

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <Input
          ref={inputRef}
          type="number"
          min="0"
          step="0.5"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={handleKeyDown}
          className="h-7 w-16 border-neutral-900 px-1.5 text-sm"
        />
        <span className="text-neutral-500">h</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={cn(
        "cursor-text rounded px-1 -mx-1 hover:bg-neutral-100 transition-colors",
        !label && "text-neutral-400",
        className
      )}
    >
      {label ?? placeholder}
    </button>
  );
}
