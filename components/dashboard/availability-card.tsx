import { Clock } from "lucide-react";
import type { BuilderAvailability } from "@/lib/types";

const STATUS: Record<string, { label: string; dot: string }> = {
  available: { label: "On it", dot: "bg-emerald-500" },
  limited: { label: "Limited", dot: "bg-amber-500" },
  away: { label: "Away", dot: "bg-neutral-400" },
};

export function AvailabilityCard({
  availability,
  builderName,
}: {
  availability: BuilderAvailability | null;
  builderName: string | null;
}) {
  const s = STATUS[availability?.status ?? "available"] ?? STATUS.available;
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <Clock className="h-4 w-4 text-neutral-500" />
        <h2 className="text-sm font-semibold text-neutral-900">Builder availability</h2>
      </div>
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${s.dot}`} />
        <span className="text-sm text-neutral-800">
          {builderName ?? "Your builder"} — {s.label}
          {availability?.weekly_hours != null && ` · ~${availability.weekly_hours} hrs/wk`}
        </span>
      </div>
      {availability?.note && <p className="mt-2 text-xs text-neutral-500">{availability.note}</p>}
    </div>
  );
}
