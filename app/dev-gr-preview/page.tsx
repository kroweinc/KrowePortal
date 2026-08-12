"use client";

import { GranolaTaskReview } from "@/components/granola/granola-task-review";
import type { ExtractedTaskDraft } from "@/lib/ai/schemas";

const DRAFTS: ExtractedTaskDraft[] = [
  {
    title:
      "Send detailed designation request packet to the county assessor before the appeal window closes",
    description:
      "Assemble the parcel list, prior-year valuations, and the signed authorization form into a single packet and file it with the county assessor's office. The appeal window closes at the end of the month, so this needs to go out first.",
    priority: "medium",
    type: "feature",
    tags: ["backend"],
    owner: "Request Designation",
    confidence: "medium",
    checklist: ["Pull the parcel list", "Attach the authorization", "File with the assessor"],
    dependencies: [],
    sourceQuote: "We need to get that designation packet over to the county before month end.",
    sourceText: null,
  } as unknown as ExtractedTaskDraft,
  {
    title: "Fix the login redirect loop",
    description:
      "Users who sign in from an expired session get bounced between /auth and /b indefinitely. Clear the stale cookie before redirecting.",
    priority: "urgent",
    type: "bug",
    tags: ["auth"],
    owner: "builder",
    confidence: "high",
    checklist: [],
    dependencies: [],
    sourceQuote: null,
    sourceText: null,
  } as unknown as ExtractedTaskDraft,
  {
    title:
      "Rework the staging board grouping so releases roll up per engagement branch instead of per task type",
    description:
      "Today the staging board groups by task type, which splits a single release across four columns. Group by engagement branch so a release reads as one unit.",
    priority: "high",
    type: "change",
    tags: ["ui"],
    owner: "builder",
    confidence: "low",
    checklist: ["Update staging-grouping.ts", "Add the Group-by toggle"],
    dependencies: [],
    sourceQuote: null,
    sourceText: null,
  } as unknown as ExtractedTaskDraft,
];

export default function DevGranolaPreview() {
  return (
    <div style={{ padding: 40, background: "var(--surface-subtle)", minHeight: "100vh" }}>
      <div
        className="krowe-gr-modal"
        style={{ position: "static", transform: "none", margin: "0 auto", animation: "none" }}
      >
        <div className="krowe-gr-head">
          <div className="krowe-gr-head-row">
            <div>
              <h2 className="krowe-gr-title">Tasks from meeting</h2>
              <p className="krowe-gr-sub">Review what the call asked for before it lands.</p>
            </div>
          </div>
        </div>
        <GranolaTaskReview
          drafts={DRAFTS}
          duplicateMatches={{
            "fix the login redirect loop": { id: "x", title: "Fix login redirect loop" },
          }}
          submitting={false}
          streaming={false}
          onSubmit={() => {}}
          onCancel={() => {}}
        />
      </div>
    </div>
  );
}
