"use client";

import { CircleHelp } from "lucide-react";

/**
 * Top-bar trigger that (re)launches the product tour. Decoupled from
 * TutorialProvider via a window event so Nav — which sits above the provider in
 * the builder layout tree — doesn't need to share React context with it.
 */
export function TourHelpButton() {
  return (
    <button
      type="button"
      className="krowe-tb-icon"
      title="Take the tour"
      data-tour="help-button"
      onClick={() => window.dispatchEvent(new CustomEvent("krowe:start-tour"))}
    >
      <CircleHelp size={18} />
    </button>
  );
}
