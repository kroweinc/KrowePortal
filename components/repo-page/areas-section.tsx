"use client";

import { useState, useTransition } from "react";
import { RefreshCw, Shapes, Tags } from "lucide-react";
import { toast } from "sonner";
import {
  countTasksForRetag,
  refreshRepoAreas,
  retagEngagementTasks,
} from "@/lib/actions/repo-areas";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { AreaDefinition } from "@/lib/types";
import { SectionHead } from "./section-head";

/**
 * The label vocabulary this repo's tasks are filed under — derived once from the
 * repo and reused by every AI classifier (lib/tasks/area-vocabulary.ts). Shown
 * here because it's otherwise invisible: a builder seeing "checkout" on a task
 * chip has no other way to learn where that list came from or how to change it.
 */
export function AreasSection({
  engagementId,
  initialAreas,
}: {
  engagementId: string | null;
  initialAreas: AreaDefinition[];
}) {
  const [areas, setAreas] = useState(initialAreas);
  const [pending, startTransition] = useTransition();
  const [retagging, startRetag] = useTransition();
  const [confirm, confirmDialog] = useConfirm();

  function onRefresh() {
    startTransition(async () => {
      const result = await refreshRepoAreas(engagementId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setAreas(result.areas);
      toast.success(`Named ${result.areas.length} areas from this repo.`);
    });
  }

  async function onRetag() {
    const count = await countTasksForRetag(engagementId);
    if (count === 0) {
      toast.info("No tasks here to re-file yet.");
      return;
    }
    const ok = await confirm({
      title: `Re-file ${count} ${count === 1 ? "task" : "tasks"} under these areas?`,
      description:
        "Krowe reads every task and files it under the area it belongs to. Areas you picked by hand are replaced too — there's no way to tell those apart from the ones Krowe chose.",
      confirmText: "Re-file tasks",
      cancelText: "Cancel",
      icon: Tags,
    });
    if (!ok) return;

    startRetag(async () => {
      const result = await retagEngagementTasks(engagementId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      if (result.retagged === 0) {
        toast.success("Every task was already under the right area.");
      } else if (result.capped) {
        // The run is capped so it finishes inside the request budget; say so
        // rather than letting the count quietly disagree with the confirm.
        toast.success(
          `Re-filed ${result.retagged} of the first ${result.considered}. Run it again for the rest.`
        );
      } else {
        toast.success(`Re-filed ${result.retagged} of ${result.considered} tasks.`);
      }
    });
  }

  return (
    <section className="krowe-repo-section">
      <SectionHead icon={Shapes} title="Areas" />

      <div className="krowe-repo-card krowe-areas-card">
        <div className="krowe-areas-head">
          <p className="krowe-areas-lede">
            {areas.length > 0
              ? "Every task on this project is filed under one of these. Krowe picks the area when it drafts a task."
              : "Krowe hasn't read this repo for its areas yet, so tasks are filed under general labels like “backend” and “ui”."}
          </p>
          <button
            type="button"
            className="krowe-btn-pill ghost krowe-areas-refresh"
            onClick={onRefresh}
            disabled={pending}
          >
            <RefreshCw size={13} strokeWidth={2} aria-hidden />
            {pending ? "Reading the repo…" : areas.length > 0 ? "Refresh" : "Find areas"}
          </button>
        </div>

        {areas.length > 0 && (
          <>
            <ul className="krowe-areas-list">
              {areas.map((area) => (
                <li key={area.slug} className="krowe-areas-item">
                  <span className="krowe-chip krowe-chip-tag">{area.slug}</span>
                  <span className="krowe-areas-gloss">{area.gloss}</span>
                </li>
              ))}
            </ul>

            {/* Tasks written before this vocabulary existed still wear generic
                labels. One button re-files them so the board reads as one system. */}
            <div className="krowe-areas-foot">
              <button
                type="button"
                className="krowe-btn-pill ghost"
                onClick={onRetag}
                disabled={retagging || pending}
              >
                <Tags size={13} strokeWidth={2} aria-hidden />
                {retagging ? "Re-filing tasks…" : "Re-file existing tasks"}
              </button>
            </div>
          </>
        )}
      </div>
      {confirmDialog}
    </section>
  );
}
