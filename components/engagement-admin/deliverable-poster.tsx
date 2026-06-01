"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { postDeliverable, deleteDeliverable } from "@/lib/actions/engagement";
import type { Deliverable, Milestone } from "@/lib/types";

export function DeliverablePoster({
  engagementId,
  deliverables,
  milestones,
}: {
  engagementId: string;
  deliverables: Deliverable[];
  milestones: Pick<Milestone, "id" | "title">[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [milestoneId, setMilestoneId] = useState("");

  function post() {
    if (title.trim().length === 0) return toast.error("Give the deliverable a title.");
    startTransition(async () => {
      const result = await postDeliverable(engagementId, {
        title: title.trim(),
        body: body.trim() || null,
        url: url.trim() || null,
        milestoneId: milestoneId || null,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setTitle("");
      setBody("");
      setUrl("");
      setMilestoneId("");
      toast.success("Deliverable posted");
      router.refresh();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const result = await deleteDeliverable(id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {deliverables.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="text-neutral-800">{d.title}</span>
            <button type="button" onClick={() => remove(d.id)} disabled={isPending} className="text-neutral-300 hover:text-neutral-700">
              <X className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <div className="space-y-2 rounded-md border border-neutral-200 bg-neutral-50 p-3">
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Deliverable title" className={inputCls} />
        <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Link (preview URL, file, demo)" className={inputCls} />
        <textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Notes for the operator…" className={inputCls} />
        {milestones.length > 0 && (
          <select value={milestoneId} onChange={(e) => setMilestoneId(e.target.value)} className={inputCls}>
            <option value="">No milestone</option>
            {milestones.map((m) => (
              <option key={m.id} value={m.id}>{m.title}</option>
            ))}
          </select>
        )}
        <div className="flex justify-end">
          <Button size="sm" onClick={post} disabled={isPending}>
            {isPending ? "Posting…" : "Post deliverable"}
          </Button>
        </div>
      </div>
    </div>
  );
}

const inputCls = "w-full rounded border border-neutral-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400";
