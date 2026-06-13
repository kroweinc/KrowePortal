"use client";

/* Free-text input with a custom suggestion dropdown rendered directly below
   it (replaces native <datalist>, whose popup placement/styling the browser
   controls). Typing filters the list; click or ↑/↓ + Enter picks one; Escape
   or clicking elsewhere closes it. The value is never restricted to the
   list — suggestions only accelerate the common cases. */

import { useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { BrandLogo } from "@/components/prd/brand-logo";

interface SuggestInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  suggestions: readonly string[];
  placeholder?: string;
  maxLength?: number;
  /** When set, each suggestion (and the input itself when its value resolves)
      shows a BrandLogo for the returned domain. Return null for no logo. */
  logoDomain?: (suggestion: string) => string | null;
}

const MAX_VISIBLE = 8;

export function SuggestInput({
  id,
  value,
  onChange,
  suggestions,
  placeholder,
  maxLength,
  logoDomain,
}: SuggestInputProps) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const listRef = useRef<HTMLUListElement>(null);

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    const pool = q ? suggestions.filter((s) => s.toLowerCase().includes(q)) : suggestions;
    // The exact current value as the only match means it's already picked.
    if (pool.length === 1 && pool[0].toLowerCase() === q) return [];
    return pool.slice(0, MAX_VISIBLE);
  }, [value, suggestions]);

  const visible = open && matches.length > 0;
  // Logo inside the input's left edge once the value resolves to a known domain.
  const valueDomain = logoDomain?.(value) ?? null;

  function pick(s: string) {
    onChange(s);
    setOpen(false);
    setHighlighted(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!visible) {
      if (e.key === "ArrowDown") setOpen(true);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const dir = e.key === "ArrowDown" ? 1 : -1;
      const next = (highlighted + dir + matches.length) % matches.length;
      setHighlighted(next);
      listRef.current?.children[next]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      if (highlighted >= 0) {
        e.preventDefault();
        pick(matches[highlighted]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setHighlighted(-1);
    }
  }

  return (
    <div className="relative">
      {valueDomain && (
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2">
          <BrandLogo domain={valueDomain} name={value} size={18} />
        </span>
      )}
      <Input
        id={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHighlighted(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setHighlighted(-1);
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete="off"
        role="combobox"
        aria-expanded={visible}
        aria-controls={`${id}-suggestions`}
        aria-autocomplete="list"
        className={valueDomain ? "pl-9" : undefined}
      />
      {visible && (
        <ul
          id={`${id}-suggestions`}
          ref={listRef}
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-md border border-neutral-200 bg-white py-1 shadow-md"
        >
          {matches.map((s, i) => (
            <li
              key={s}
              role="option"
              aria-selected={i === highlighted}
              // mousedown (not click) so selection wins the race against the
              // input's blur, which unmounts this list before click fires.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
              onMouseEnter={() => setHighlighted(i)}
              className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-neutral-800 ${
                i === highlighted ? "bg-neutral-100" : ""
              }`}
            >
              {logoDomain && <BrandLogo domain={logoDomain(s)} name={s} size={18} />}
              <span className="truncate">{s}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
