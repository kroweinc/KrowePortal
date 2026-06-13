"use client";

/* Company name input with an async autocomplete dropdown for the Experience
   form. Mirrors SuggestInput's look and keyboard behavior, but suggestions
   come from Clearbit's free company-suggest API (name + real website domain,
   no key needed) instead of a static list. Picking a suggestion fills the
   name AND captures the verified domain so BrandLogo can show the company's
   real logo; typing free text keeps the field unrestricted and clears the
   domain (an unpicked name has no verified host → initials fallback). */

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { BrandLogo } from "@/components/prd/brand-logo";

interface CompanySuggestion {
  name: string;
  domain: string;
}

const MAX_VISIBLE = 6;
const DEBOUNCE_MS = 200;

async function fetchSuggestions(query: string): Promise<CompanySuggestion[]> {
  const res = await fetch(
    `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(query)}`
  );
  if (!res.ok) return [];
  const data: { name?: string; domain?: string }[] = await res.json();
  return data
    .filter((d): d is CompanySuggestion => !!d.name && !!d.domain)
    .slice(0, MAX_VISIBLE);
}

export function CompanySuggestInput({
  id,
  value,
  domain,
  onChange,
  placeholder,
  maxLength,
}: {
  id: string;
  value: string;
  /** The currently captured verified domain (null when free-typed). */
  domain: string | null;
  /** Fired on every change: typing passes (text, null); picking a suggestion
      passes (name, domain). */
  onChange: (value: string, domain: string | null) => void;
  placeholder?: string;
  maxLength?: number;
}) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [matches, setMatches] = useState<CompanySuggestion[]>([]);
  const listRef = useRef<HTMLUListElement>(null);
  // Guards against out-of-order responses: only the latest query may apply.
  const queryRef = useRef("");

  useEffect(() => {
    const q = value.trim();
    queryRef.current = q;
    // A picked value needs no lookup; same for queries too short to mean much.
    if (domain || q.length < 2) {
      setMatches([]);
      return;
    }
    const timer = setTimeout(() => {
      fetchSuggestions(q)
        .then((results) => {
          if (queryRef.current === q) setMatches(results);
        })
        .catch(() => {
          if (queryRef.current === q) setMatches([]);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, domain]);

  const visible = open && matches.length > 0;

  function pick(s: CompanySuggestion) {
    onChange(s.name, s.domain);
    setOpen(false);
    setHighlighted(-1);
    setMatches([]);
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
      {domain && (
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2">
          <BrandLogo domain={domain} name={value} size={18} />
        </span>
      )}
      <Input
        id={id}
        value={value}
        onChange={(e) => {
          // Any manual edit invalidates the previously picked domain.
          onChange(e.target.value, null);
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
        className={domain ? "pl-9" : undefined}
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
              key={s.domain}
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
              <BrandLogo domain={s.domain} name={s.name} size={18} />
              <span className="truncate">{s.name}</span>
              <span className="ml-auto shrink-0 text-[11px] text-neutral-400">{s.domain}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
