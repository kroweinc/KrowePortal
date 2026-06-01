"use client";

import { useState } from "react";
import { Plus, X, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function EditorSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
        {hint && <p className="text-xs text-neutral-500 mt-0.5">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export function TextField({
  value,
  onChange,
  rows = 3,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      className="w-full rounded border border-neutral-200 px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-neutral-400"
    />
  );
}

export function StringListEditor({
  items,
  onChange,
  placeholder,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  function update(i: number, value: string) {
    onChange(items.map((it, idx) => (idx === i ? value : it)));
  }
  function remove(i: number) {
    onChange(items.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([...items, ""]);
  }
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="text"
            value={it}
            onChange={(e) => update(i, e.target.value)}
            placeholder={placeholder}
            className="flex-1 rounded border border-neutral-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
          />
          <button
            type="button"
            onClick={() => remove(i)}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-red-500"
            aria-label="Remove"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900"
      >
        <Plus className="h-3 w-3" /> Add
      </button>
    </div>
  );
}

// Copy the public, shareable link for a document (e.g. /prd/<token>).
export function DocLinkButton({ path, label = "Copy link" }: { path: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    const url = `${window.location.origin}${path}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <Button variant="outline" onClick={copy} size="sm">
      <Copy className="h-3.5 w-3.5" /> {copied ? "Copied!" : label}
    </Button>
  );
}
