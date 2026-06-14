import type { PipelineStage, ProjectPipeline, StageStatus } from "@/lib/project/stage";

const STATUS_CAPTION: Record<StageStatus, string> = {
  not_started: "Not started",
  draft: "Draft",
  sent: "Sent",
  signed: "Signed",
  done: "Live",
};

// Maps a stage's lifecycle status to the colored dot / status-caption class.
function toneClass(status: StageStatus): "draft" | "sent" | "signed" | "idle" {
  if (status === "signed" || status === "done") return "signed";
  if (status === "sent") return "sent";
  if (status === "draft") return "draft";
  return "idle";
}

// Guided, not enforced: the grid only visualizes where the deal is —
// every stage stays clickable/creatable regardless of order. Each cell
// anchor-scrolls to its section below.
export function PipelineStepper({ pipeline }: { pipeline: ProjectPipeline }) {
  return (
    <div className="pipeline">
      {pipeline.stages.map((stage: PipelineStage) => {
        const tone = toneClass(stage.status);
        const lit = stage.status !== "not_started";
        const statusTone = tone === "sent" || tone === "signed" ? tone : "";
        return (
          <a key={stage.key} href={`#${stage.key}`} className={`pstep ${lit ? "lit" : "dim"}`}>
            <div className="pstep-top">
              <span className={`pdot ${tone}`} />
              <span className="pname">{stage.label}</span>
            </div>
            <span className={`pstatus ${statusTone}`}>{STATUS_CAPTION[stage.status]}</span>
          </a>
        );
      })}
    </div>
  );
}
