"use client";

/* MoneyInput — a click-to-edit currency field for the quote editor. Reads as a
   formatted dollar amount ($1,200); in edit mode it becomes an inline text input
   that parses to a number on commit. Mirrors InlineText's interaction model so it
   feels native to the rail. */

import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { useEditing } from "@/components/prd/dashboard/inline-edit";
import { formatUSD, parseMoney } from "@/lib/quote/format";

interface MoneyInputProps {
  value?: number | null;
  onChange: (v: number) => void;
  className?: string;
  /** Show "$0" in read mode when the value is zero/empty (default true). */
  showZero?: boolean;
}

export function MoneyInput({ value, onChange, className = "", showZero = true }: MoneyInputProps) {
  const editing = useEditing();
  const [active, setActive] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ""));
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!active) setDraft(value != null && value !== 0 ? String(value) : "");
  }, [value, active]);

  useLayoutEffect(() => {
    if (active && ref.current) {
      ref.current.focus();
      ref.current.select();
    }
  }, [active]);

  function commit() {
    setActive(false);
    const next = parseMoney(draft);
    if (next !== (Number(value) || 0)) onChange(next);
  }

  if (!editing) {
    if (!value && !showZero) return null;
    return <span className={"money-value " + className}>{formatUSD(value)}</span>;
  }

  if (active) {
    return (
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        placeholder="$0"
        className={"inline-input money-input " + className}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setDraft(String(value ?? ""));
            setActive(false);
          }
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
      />
    );
  }

  return (
    <span
      className={"inline-editable money-value " + className}
      tabIndex={0}
      onClick={() => setActive(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          setActive(true);
        }
      }}
    >
      {formatUSD(value)}
    </span>
  );
}
