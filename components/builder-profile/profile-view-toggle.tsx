"use client";

import { useState } from "react";

// Edit/Preview switch for the profile tab. Preview embeds /p/preview in an
// iframe so it renders pixel-identical to the live share link — same
// component, same layout chain, isolated from portal CSS. The editor is
// hidden (not unmounted) so unsaved form state survives toggling; the iframe
// remounts on each switch so it always shows fresh data. No sandbox attribute:
// the same-origin frame needs cookies + scripts for auth and the resume action.
export function ProfileViewToggle({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<"edit" | "preview">("edit");

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <div
          role="tablist"
          aria-label="Profile view mode"
          className="inline-flex rounded-full border border-neutral-200 bg-neutral-100 p-[3px]"
        >
          <ModeButton active={mode === "edit"} onClick={() => setMode("edit")}>
            Edit
          </ModeButton>
          <ModeButton active={mode === "preview"} onClick={() => setMode("preview")}>
            Preview
          </ModeButton>
        </div>
      </div>

      <div hidden={mode === "preview"}>{children}</div>

      {mode === "preview" && (
        <iframe
          src="/p/preview"
          title="Profile preview — exactly as clients see your share link"
          className="w-full rounded-lg border border-neutral-200 bg-neutral-50"
          style={{ height: "calc(100vh - 240px)", minHeight: 600 }}
        />
      )}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        "rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors " +
        (active
          ? "bg-white text-neutral-900 shadow-sm"
          : "text-neutral-500 hover:text-neutral-900")
      }
    >
      {children}
    </button>
  );
}
