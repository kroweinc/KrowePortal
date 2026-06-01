"use client";

import { X, Plus } from "lucide-react";
import type { BriefLineItem } from "@/lib/types";

interface BriefLineItemsProps {
  items: BriefLineItem[];
  hourlyRate: number;
  onChange: (items: BriefLineItem[]) => void;
  disabled?: boolean;
  emptyHint?: string;
  showHours?: boolean;
}

function recalcAmount(hours: number | null | undefined, rate: number): number {
  if (hours == null || Number.isNaN(hours)) return 0;
  return Math.round(hours * rate);
}

export function BriefLineItems({
  items,
  hourlyRate,
  onChange,
  disabled,
  emptyHint = "No line items yet.",
  showHours = true,
}: BriefLineItemsProps) {
  function update(idx: number, patch: Partial<BriefLineItem>) {
    const next = items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
    onChange(next);
  }

  function remove(idx: number) {
    onChange(items.filter((_, i) => i !== idx));
  }

  function add() {
    onChange([...items, { label: "", hours: null, amount: 0, notes: null }]);
  }

  return (
    <div className="space-y-2">
      {items.length === 0 ? (
        <p className="text-xs text-neutral-400 italic">{emptyHint}</p>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-12 gap-2 px-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
            <span className="col-span-5">Description</span>
            {showHours && <span className="col-span-2">Hours</span>}
            <span className={showHours ? "col-span-2" : "col-span-4"}>Amount ($)</span>
            <span className="col-span-2">Notes</span>
            <span className="col-span-1" aria-hidden="true" />
          </div>
          {items.map((item, idx) => (
            <div
              key={idx}
              className="grid grid-cols-12 gap-2 items-start rounded-md border border-neutral-200 bg-white p-2"
            >
              <input
                type="text"
                value={item.label}
                onChange={(e) => update(idx, { label: e.target.value })}
                placeholder="Line item label"
                disabled={disabled}
                className="col-span-5 rounded border border-neutral-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
              />
              {showHours && (
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  value={item.hours ?? ""}
                  onChange={(e) => {
                    const hours = e.target.value === "" ? null : Number(e.target.value);
                    update(idx, {
                      hours,
                      amount: recalcAmount(hours, hourlyRate),
                    });
                  }}
                  placeholder="hrs"
                  disabled={disabled}
                  className="col-span-2 rounded border border-neutral-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
                />
              )}
              <input
                type="number"
                step="1"
                min="0"
                value={item.amount}
                onChange={(e) => update(idx, { amount: Number(e.target.value) || 0 })}
                placeholder="$"
                disabled={disabled}
                className={`${showHours ? "col-span-2" : "col-span-4"} rounded border border-neutral-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400`}
              />
              <input
                type="text"
                value={item.notes ?? ""}
                onChange={(e) => update(idx, { notes: e.target.value || null })}
                placeholder="Notes (optional)"
                disabled={disabled}
                className={`${showHours ? "col-span-2" : "col-span-2"} rounded border border-neutral-200 px-2 py-1.5 text-xs text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-400`}
              />
              <button
                type="button"
                onClick={() => remove(idx)}
                disabled={disabled}
                className="col-span-1 inline-flex h-7 w-7 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-red-500 disabled:opacity-40"
                aria-label="Remove line item"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={add}
        disabled={disabled}
        className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900 disabled:opacity-40"
      >
        <Plus className="h-3 w-3" /> Add line item
      </button>
    </div>
  );
}
