import "./engagement.css";

export type EngagementStatusKind = "live" | "pend" | "none";

/* The colored status dot + label: live (operator connected), pend (invite out),
   none (no operator yet). Shared by the list card and the Manage hero. */
export function EngagementStatus({ kind, label }: { kind: EngagementStatusKind; label: string }) {
  return (
    <span className={`eng-status ${kind}`}>
      <span className="dot" />
      {label}
    </span>
  );
}
