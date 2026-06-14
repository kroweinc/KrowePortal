"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setAvailability, clearAvailability } from "@/lib/actions/engagement";
import type { BuilderAvailability, AvailabilityStatus } from "@/lib/types";

export function AvailabilityEditor({
  engagementId,
  availability,
}: {
  engagementId: string;
  availability: BuilderAvailability | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<AvailabilityStatus>(availability?.status ?? "available");
  const [hours, setHours] = useState<string>(
    availability?.weekly_hours != null ? String(availability.weekly_hours) : ""
  );
  const [note, setNote] = useState(availability?.note ?? "");

  function save() {
    startTransition(async () => {
      const result = await setAvailability(engagementId, {
        status,
        weeklyHours: hours.trim() ? Number(hours) : null,
        note: note.trim() || null,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Availability updated");
      router.refresh();
    });
  }

  function clear() {
    const confirmed = window.confirm(
      "Remove your availability for this client? The operator will no longer see a status."
    );
    if (!confirmed) return;
    startTransition(async () => {
      const result = await clearAvailability(engagementId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setStatus("available");
      setHours("");
      setNote("");
      toast.success("Availability cleared");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {(["available", "limited", "away"] as AvailabilityStatus[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded px-3 py-1 text-sm capitalize ${status === s ? "bg-neutral-900 text-white" : "border border-neutral-200 bg-white"}`}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="flex gap-3">
        <input
          type="number"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          placeholder="Hrs / week"
          className="w-32 rounded border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
        />
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note (e.g. out Friday)"
          className="flex-1 rounded border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
        />
      </div>
      <div className="flex justify-end gap-2">
        {availability !== null && (
          <Button
            variant="outline"
            size="sm"
            onClick={clear}
            disabled={isPending}
            className="text-red-600 hover:bg-red-50 hover:text-red-700"
          >
            Clear
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={save} disabled={isPending}>
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
