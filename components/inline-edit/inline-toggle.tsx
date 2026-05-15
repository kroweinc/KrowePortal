"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { BadgeProps } from "@/components/ui/badge";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

interface InlineToggleProps {
  value: boolean;
  onToggle: (newValue: boolean) => Promise<void>;
  trueLabel: string;
  falseLabel: string;
  trueBadgeVariant?: BadgeVariant;
  falseBadgeVariant?: BadgeVariant;
  className?: string;
}

export function InlineToggle({
  value,
  onToggle,
  trueLabel,
  falseLabel,
  trueBadgeVariant = "secondary",
  falseBadgeVariant = "outline",
  className,
}: InlineToggleProps) {
  const [localValue, setLocalValue] = useState(value);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleClick() {
    const newValue = !localValue;
    setLocalValue(newValue);
    startTransition(async () => {
      await onToggle(newValue);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className={cn("cursor-pointer hover:opacity-80 transition-opacity disabled:opacity-50", className)}
    >
      <Badge variant={localValue ? trueBadgeVariant : falseBadgeVariant}>
        {localValue ? trueLabel : falseLabel}
      </Badge>
    </button>
  );
}
