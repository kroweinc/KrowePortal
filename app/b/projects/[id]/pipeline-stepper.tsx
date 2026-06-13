import type { PipelineStage, ProjectPipeline, StageStatus } from "@/lib/project/stage";

const STATUS_CAPTION: Record<StageStatus, string> = {
  not_started: "Not started",
  draft: "Draft",
  sent: "Sent",
  signed: "Signed",
  done: "Live",
};

function dotClass(stage: PipelineStage, isCurrent: boolean): string {
  if (stage.status === "signed" || stage.status === "done") return "bg-emerald-500";
  if (stage.status === "sent") return "bg-sky-500";
  if (stage.status === "draft") return "bg-neutral-400";
  return isCurrent ? "bg-neutral-300 ring-2 ring-neutral-400" : "bg-neutral-200";
}

// Guided, not enforced: the stepper only visualizes where the deal is —
// every stage stays clickable/creatable regardless of order.
export function PipelineStepper({ pipeline }: { pipeline: ProjectPipeline }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-4 py-3">
      <ol className="flex items-center">
        {pipeline.stages.map((stage, i) => {
          const isCurrent = stage.key === pipeline.current;
          return (
            <li key={stage.key} className="flex items-center flex-1 last:flex-none">
              <a href={`#${stage.key}`} className="group flex items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotClass(stage, isCurrent)}`}
                />
                <span className="flex flex-col leading-tight">
                  <span
                    className={`text-xs font-medium group-hover:underline ${
                      isCurrent ? "text-neutral-900" : "text-neutral-600"
                    }`}
                  >
                    {stage.label}
                  </span>
                  <span className="text-[10px] text-neutral-400">
                    {STATUS_CAPTION[stage.status]}
                  </span>
                </span>
              </a>
              {i < pipeline.stages.length - 1 && (
                <span className="mx-3 h-px flex-1 bg-neutral-200" aria-hidden />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
