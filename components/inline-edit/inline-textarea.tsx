"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface InlineTextareaProps {
  value: string;
  onSave: (value: string) => Promise<void>;
  readOnly?: boolean;
  className?: string;
  placeholder?: string;
}

export function InlineTextarea({
  value,
  onSave,
  readOnly,
  className,
  placeholder = "Add a description",
}: InlineTextareaProps) {
  const [editing, setEditing] = useState(false);
  const [localValue, setLocalValue] = useState(value);
  const [, startTransition] = useTransition();
  const ref = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!editing) setLocalValue(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  function save() {
    setEditing(false);
    if (localValue === value) return;
    startTransition(async () => {
      await onSave(localValue);
      router.refresh();
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      setLocalValue(value);
      setEditing(false);
    }
  }

  if (readOnly) {
    return (
      <p className={cn("text-sm text-neutral-600 leading-relaxed whitespace-pre-wrap", className)}>
        {localValue || <span className="text-neutral-400">{placeholder}</span>}
      </p>
    );
  }

  if (editing) {
    return (
      <Textarea
        ref={ref}
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={save}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={cn("border-neutral-900 min-h-[100px]", className)}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={cn(
        "block w-full text-left cursor-text rounded px-1.5 py-1 -mx-1.5 hover:bg-neutral-100 transition-colors text-sm text-neutral-600 leading-relaxed whitespace-pre-wrap",
        className
      )}
    >
      {localValue || <span className="text-neutral-400">{placeholder}</span>}
    </button>
  );
}
