"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface InlineTextProps {
  value: string;
  onSave: (value: string) => Promise<void>;
  readOnly?: boolean;
  className?: string;
  placeholder?: string;
}

export function InlineText({
  value,
  onSave,
  readOnly,
  className,
  placeholder = "Click to edit",
}: InlineTextProps) {
  const [editing, setEditing] = useState(false);
  const [localValue, setLocalValue] = useState(value);
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!editing) setLocalValue(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function save() {
    setEditing(false);
    const trimmed = localValue.trim();
    if (trimmed === value || trimmed === "") return;
    startTransition(async () => {
      await onSave(trimmed);
      router.refresh();
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      setLocalValue(value);
      setEditing(false);
    }
  }

  if (readOnly) {
    return (
      <span className={className}>
        {localValue || <span className="text-neutral-400">{placeholder}</span>}
      </span>
    );
  }

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={save}
        onKeyDown={handleKeyDown}
        className={cn("border-neutral-900", className)}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={cn(
        "block w-full text-left cursor-text rounded px-1.5 py-0.5 -mx-1.5 hover:bg-neutral-100 transition-colors",
        className
      )}
    >
      {localValue || <span className="text-neutral-400">{placeholder}</span>}
    </button>
  );
}
