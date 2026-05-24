"use client";

import { Loader2, Sparkles } from "lucide-react";
import { usePlainEnglish } from "@/components/plain-english-context";
import { cn } from "@/lib/utils";

export function PlainEnglishToggle() {
  const { enabled, toggle, loadingCount } = usePlainEnglish();
  const loading = loadingCount > 0;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={enabled}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        enabled
          ? "border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100"
          : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
      )}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Sparkles className="h-3.5 w-3.5" />
      )}
      <span>{enabled ? "Translated" : "English"}</span>
      <span
        aria-hidden
        className={cn(
          "relative inline-block h-4 w-8 shrink-0 rounded-full transition-colors",
          enabled ? "bg-violet-500" : "bg-neutral-300"
        )}
      >
        <span
          className={cn(
            "absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform",
            enabled ? "translate-x-4" : "translate-x-0"
          )}
        />
      </span>
    </button>
  );
}
