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

const inputClass = "krowe-set-input narrow";

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
    <div>
      {/* Hourly rate */}
      <div className="krowe-set-field">
        <label htmlFor="default_hourly_rate" className="krowe-set-label">
          Default hourly rate
        </label>
        <p className="krowe-set-note">
          The blended rate new quotes price line items at (hours × rate).
        </p>
        <div className="krowe-set-field-row">
          <span className="krowe-set-hint-inline">$</span>
          <input
            id="default_hourly_rate"
            type="number"
            min={0}
            step={5}
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className={inputClass}
          />
          <span className="krowe-set-hint-inline">per hour</span>
        </div>
      </div>

      <div className="krowe-set-rule" />

      {/* Payment terms */}
      <div className="krowe-set-field">
        <label htmlFor="payment_terms" className="krowe-set-label">
          Payment terms
        </label>
        <p className="krowe-set-note">The payment schedule new quotes start from.</p>
        <div className="krowe-set-field-row">
          <select
            id="payment_terms"
            value={terms}
            onChange={(e) => setTerms(e.target.value as PaymentTermsPreset)}
            className="krowe-set-select"
            style={{ width: "auto", minWidth: "190px" }}
          >
            {PAYMENT_TERMS_PRESETS.map((p) => (
              <option key={p} value={p}>
                {PAYMENT_TERMS_LABELS[p]}
              </option>
            ))}
          </select>
          <span className="krowe-set-hint-inline">Split: {milestonePreview}</span>
        </div>
      </div>

      <div className="krowe-set-rule" />

      {/* Design system */}
      <div className="krowe-set-field">
        <span className="krowe-set-label">Design system</span>
        <p className="krowe-set-note">How the design system is handled on new quotes.</p>
        <div className="krowe-set-radio-group">
          {DESIGN_SYSTEM_MODES.map((mode) => (
            <div key={mode}>
              <label className={`krowe-set-radio-row ${designMode === mode ? "sel" : ""}`}>
                <input
                  type="radio"
                  name="design_system_mode"
                  value={mode}
                  checked={designMode === mode}
                  onChange={() => setDesignMode(mode)}
                  className="sr-only"
                />
                <span className="krowe-set-radio-dot" aria-hidden="true" />
                <span>
                  <span className="krowe-set-radio-label">{DESIGN_MODE_LABELS[mode]}</span>
                  <span className="krowe-set-radio-hint">{DESIGN_MODE_HINTS[mode]}</span>
                </span>
              </label>
              {mode === "fixed" && designMode === "fixed" && (
                <div className="krowe-set-inline-cost">
                  <span className="krowe-set-hint-inline">$</span>
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={designCost}
                    onChange={(e) => setDesignCost(e.target.value)}
                    placeholder="0"
                    className={inputClass}
                    aria-label="Design system fixed cost"
                  />
                  <span className="krowe-set-hint-inline">design charge</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="krowe-set-card-foot">
        <button type="button" onClick={save} disabled={!canSave} className="krowe-set-btn-dark">
          {isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
