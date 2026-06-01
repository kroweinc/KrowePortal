"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Paperclip, Plus, X, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addContextMaterial, deleteContextMaterial } from "@/lib/actions/engagement";
import type { ContextMaterial } from "@/lib/types";

export function MaterialsCard({
  engagementId,
  materials,
  canEdit,
}: {
  engagementId: string;
  materials: ContextMaterial[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<"link" | "note">("link");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [body, setBody] = useState("");

  function add() {
    if (title.trim().length === 0) {
      toast.error("Give it a title.");
      return;
    }
    startTransition(async () => {
      const result = await addContextMaterial(engagementId, {
        kind,
        title: title.trim(),
        url: kind === "link" ? url.trim() || null : null,
        body: kind === "note" ? body.trim() || null : null,
        category: null,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setTitle("");
      setUrl("");
      setBody("");
      setAdding(false);
      toast.success("Added");
      router.refresh();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const result = await deleteContextMaterial(id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Paperclip className="h-4 w-4 text-neutral-500" />
          <h2 className="text-sm font-semibold text-neutral-900">Reference materials</h2>
        </div>
        {canEdit && (
          <Button variant="ghost" size="sm" onClick={() => setAdding((v) => !v)} disabled={isPending}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        )}
      </div>

      {materials.length === 0 && !adding && (
        <p className="text-xs text-neutral-400">
          {canEdit
            ? "Drop links to your current system, data exports, examples, brand assets — anything that helps the builder."
            : "No materials yet."}
        </p>
      )}

      <ul className="space-y-2">
        {materials.map((m) => (
          <li key={m.id} className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm text-neutral-800">
                {m.kind === "link" && m.url ? (
                  <a href={m.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline hover:text-neutral-900">
                    {m.title}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <span className="font-medium">{m.title}</span>
                )}
              </div>
              {m.body && <p className="mt-0.5 whitespace-pre-wrap text-xs text-neutral-500">{m.body}</p>}
            </div>
            {canEdit && (
              <button type="button" onClick={() => remove(m.id)} disabled={isPending} className="text-neutral-300 hover:text-neutral-700">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>

      {adding && canEdit && (
        <div className="mt-3 space-y-2 rounded-md border border-neutral-200 bg-neutral-50 p-3">
          <div className="flex gap-2 text-xs">
            <button type="button" onClick={() => setKind("link")} className={`rounded px-2 py-1 ${kind === "link" ? "bg-neutral-900 text-white" : "bg-white border border-neutral-200"}`}>Link</button>
            <button type="button" onClick={() => setKind("note")} className={`rounded px-2 py-1 ${kind === "note" ? "bg-neutral-900 text-white" : "bg-white border border-neutral-200"}`}>Note</button>
          </div>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="w-full rounded border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
          />
          {kind === "link" ? (
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              className="w-full rounded border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
            />
          ) : (
            <textarea
              rows={3}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Note…"
              className="w-full rounded border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
            />
          )}
          <div className="flex justify-end">
            <Button size="sm" onClick={add} disabled={isPending}>
              {isPending ? "Adding…" : "Add material"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
