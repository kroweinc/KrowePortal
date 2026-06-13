// Pure pipeline-stage derivation for the outbound project flow:
// PRD → Quote → Contract → Engagement. Guided, not enforced — this is
// presentational; nothing gates on it except the Begin-engagement CTA emphasis.

import type { Contract, Engagement, Prd, Quote } from "@/lib/types";

export type PipelineStageKey = "prd" | "quote" | "contract" | "engagement";
export type StageStatus = "not_started" | "draft" | "sent" | "signed" | "done";

export interface PipelineStage {
  key: PipelineStageKey;
  label: string;
  status: StageStatus;
}

export interface ProjectPipeline {
  stages: PipelineStage[]; // always 4, in pipeline order
  current: PipelineStageKey; // first stage not yet signed/done
  contractSigned: boolean;
  engagementStarted: boolean;
}

// Best status across a doc type's rows. Quote "accepted" counts as signed.
// Rejected-only collapses to "draft" — the builder still has a doc to rework.
function docStageStatus(docs: { status: string }[]): StageStatus {
  if (docs.some((d) => d.status === "signed" || d.status === "accepted")) return "signed";
  if (docs.some((d) => d.status === "sent")) return "sent";
  if (docs.length > 0) return "draft";
  return "not_started";
}

export function derivePipeline(input: {
  prds: Pick<Prd, "status">[];
  quotes: Pick<Quote, "status">[];
  contracts: Pick<Contract, "status">[];
  engagement: Pick<Engagement, "id"> | null;
}): ProjectPipeline {
  const contractStatus = docStageStatus(input.contracts);
  const stages: PipelineStage[] = [
    { key: "prd", label: "PRD", status: docStageStatus(input.prds) },
    { key: "quote", label: "Quote", status: docStageStatus(input.quotes) },
    { key: "contract", label: "Contract", status: contractStatus },
    { key: "engagement", label: "Engagement", status: input.engagement ? "done" : "not_started" },
  ];

  const current =
    stages.find((s) => s.status !== "signed" && s.status !== "done")?.key ?? "engagement";

  return {
    stages,
    current,
    contractSigned: contractStatus === "signed",
    engagementStarted: input.engagement !== null,
  };
}
