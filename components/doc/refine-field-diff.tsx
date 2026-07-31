"use client";

/* The refine preview's change marking, shared by the PRD and quote dialogs: list
   items tagged kept / new against what's in the section today, anything dropped
   shown after, and a non-list value tagged rewritten. This is the promise the
   refine flow makes ("it added to your section, it didn't replace it"), so it
   lives in one place — each dialog supplies only its own value renderer. */

import type { ReactNode } from "react";
import { diffList, isUnchanged } from "@/lib/doc/refine";

type TagStatus = "kept" | "new" | "removed" | "rewritten";

export function Tag({ status }: { status: TagStatus }) {
  return <span className={`krowe-refine-tag is-${status}`}>{status}</span>;
}

export function FieldDiff({
  current,
  next,
  renderValue,
}: {
  current: unknown;
  next: unknown;
  /** The dialog's own read-only value renderer (the quote's formats currency). */
  renderValue: (value: unknown) => ReactNode;
}) {
  const diff = diffList(current, next);

  if (!diff) {
    return (
      <div className="space-y-1">
        {!isUnchanged(current, next) && <Tag status="rewritten" />}
        {renderValue(next)}
      </div>
    );
  }

  const items = next as unknown[];
  return (
    <div className="space-y-1.5">
      {items.map((item, i) => (
        <div key={i} className="krowe-refine-item">
          <div className="min-w-0 flex-1">{renderValue(item)}</div>
          <Tag status={diff.status[i]} />
        </div>
      ))}
      {diff.removed.map((item, i) => (
        <div key={`r-${i}`} className="krowe-refine-item is-removed">
          <div className="min-w-0 flex-1">{renderValue(item)}</div>
          <Tag status="removed" />
        </div>
      ))}
    </div>
  );
}
