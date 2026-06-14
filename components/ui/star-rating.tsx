"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface StarRatingProps {
  value: number;
  onChange: (rating: number) => void;
  /** Pixel size of each star. */
  size?: number;
}

export function StarRating({ value, onChange, size = 26 }: StarRatingProps) {
  const [hover, setHover] = useState(0);
  const active = hover || value;

  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= active;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={n === value}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            onClick={() => onChange(n)}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            className={cn(
              "rounded p-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900",
              filled ? "text-[var(--primary)]" : "text-neutral-300 hover:text-neutral-400"
            )}
          >
            <Star size={size} strokeWidth={1.8} fill={filled ? "currentColor" : "none"} />
          </button>
        );
      })}
    </div>
  );
}
