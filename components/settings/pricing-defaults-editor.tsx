"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updatePricingDefaults } from "@/lib/actions/pricing-defaults";
import {
  PAYMENT_TERMS_LABELS,
  paymentMilestonesForPreset,
  type PricingDefaults,
} from "@/lib/quote/defaults";
import {
  PAYMENT_TERMS_PRESETS,
  DESIGN_SYSTEM_MODES,
  type PaymentTermsPreset,
  type DesignSystemMode,
} from "@/lib/types";

interface PricingDefaultsEditorProps {
  initial: PricingDefaults;
}

const DESIGN_MODE_LABELS: Record<DesignSystemMode, string> = {
  included: "Included / bundled",
  fixed: "Fixed cost",
  none: "Not included",
};

const DESIGN_MODE_HINTS: Record<DesignSystemMode, string> = {
  included: "Shown as a design-system checklist on the quote, with no separate charge.",
  fixed: "Adds a single “Design system” charge to every new quote.",
  none: "No design-system line on the quote.",
};

const inputClass =
  "rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400";

export function PricingDefaultsEditor({ initial }: PricingDefaultsEditorProps) {
  const [rate, setRate] = useState(String(initial.hourlyRate));
  const [terms, setTerms] = useState<PaymentTermsPreset>(initial.paymentTermsPreset);
  const [designMode, setDesignMode] = useState<DesignSystemMode>(initial.designSystemMode);
  const [designCost, setDesignCost] = useState(String(initial.designFixedCost));
  const [saved, setSaved] = useState<PricingDefaults>(initial);
  const [isPending, startTransition] = useTransition();

  const rateNum = Math.max(0, Math.round(Number(rate) || 0));
  const designCostNum = Math.max(0, Math.round(Number(designCost) || 0));

  const dirty =
    rateNum !== saved.hourlyRate ||
    terms !== saved.paymentTermsPreset ||
    designMode !== saved.designSystemMode ||
    (designMode === "fixed" && designCostNum !== saved.designFixedCost);
  const canSave = dirty && !isPending;

  // Live preview of the milestone split for the chosen preset.
  const milestonePreview = paymentMilestonesForPreset(terms)
    .map((m) => `${m.percent}%`)
    .join(" / ");

  function save() {
    if (!canSave) return;
    startTransition(async () => {
      const result = await updatePricingDefaults({
        hourlyRate: rateNum,
        paymentTermsPreset: terms,
        designSystemMode: designMode,
        designFixedCost: designMode === "fixed" ? designCostNum : 0,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setSaved({
        hourlyRate: rateNum,
        paymentTermsPreset: terms,
        designSystemMode: designMode,
        designFixedCost: designMode === "fixed" ? designCostNum : 0,
      });
      setRate(String(rateNum));
      if (designMode === "fixed") setDesignCost(String(designCostNum));
      toast.success("Saved");
    });
  }

  return (
    <div className="space-y-5">
      {/* Hourly rate */}
      <div className="space-y-2">
        <label htmlFor="default_hourly_rate" className="block text-xs font-medium text-neutral-700">
          Default hourly rate
        </label>
        <p className="text-xs text-neutral-500">
          The blended rate new quotes price line items at (hours × rate).
        </p>
        <div className="flex items-center gap-2">
          <span className="text-sm text-neutral-500">$</span>
          <input
            id="default_hourly_rate"
            type="number"
            min={0}
            step={5}
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className={inputClass + " w-28"}
          />
          <span className="text-sm text-neutral-500">per hour</span>
        </div>
      </div>

      {/* Payment terms */}
      <div className="space-y-2 border-t border-neutral-100 pt-4">
        <label htmlFor="payment_terms" className="block text-xs font-medium text-neutral-700">
          Payment terms
        </label>
        <p className="text-xs text-neutral-500">The payment schedule new quotes start from.</p>
        <div className="flex flex-wrap items-center gap-3">
          <select
            id="payment_terms"
            value={terms}
            onChange={(e) => setTerms(e.target.value as PaymentTermsPreset)}
            className={inputClass}
          >
            {PAYMENT_TERMS_PRESETS.map((p) => (
              <option key={p} value={p}>
                {PAYMENT_TERMS_LABELS[p]}
              </option>
            ))}
          </select>
          <span className="text-xs text-neutral-500">Split: {milestonePreview}</span>
        </div>
      </div>

      {/* Design system */}
      <div className="space-y-2 border-t border-neutral-100 pt-4">
        <span className="block text-xs font-medium text-neutral-700">Design system</span>
        <p className="text-xs text-neutral-500">How the design system is handled on new quotes.</p>
        <div className="space-y-1.5">
          {DESIGN_SYSTEM_MODES.map((mode) => (
            <label key={mode} className="flex items-start gap-2 text-sm text-neutral-900">
              <input
                type="radio"
                name="design_system_mode"
                value={mode}
                checked={designMode === mode}
                onChange={() => setDesignMode(mode)}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{DESIGN_MODE_LABELS[mode]}</span>
                <span className="block text-xs text-neutral-500">{DESIGN_MODE_HINTS[mode]}</span>
              </span>
            </label>
          ))}
        </div>
        {designMode === "fixed" && (
          <div className="flex items-center gap-2 pl-6 pt-1">
            <span className="text-sm text-neutral-500">$</span>
            <input
              type="number"
              min={0}
              step={100}
              value={designCost}
              onChange={(e) => setDesignCost(e.target.value)}
              placeholder="0"
              className={inputClass + " w-32"}
              aria-label="Design system fixed cost"
            />
            <span className="text-sm text-neutral-500">design charge</span>
          </div>
        )}
      </div>

      <div className="flex justify-end border-t border-neutral-100 pt-4">
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
