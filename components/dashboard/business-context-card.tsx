"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { upsertBusinessContext } from "@/lib/actions/engagement";
import type { BusinessContextCard as BCC, BusinessContextKind } from "@/lib/types";

const CARDS: { kind: BusinessContextKind; title: string; hint: string }[] = [
  { kind: "old_workflow", title: "The old workflow", hint: "How things work today, end to end, in your words." },
  { kind: "problem", title: "The problem", hint: "What hurts about it — why this engagement exists." },
];

export function BusinessContextCard({
  engagementId,
  cards,
  canEdit,
}: {
  engagementId: string;
  cards: BCC[];
  canEdit: boolean;
}) {
  const byKind = new Map(cards.map((c) => [c.kind, c.body]));

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <BookOpen className="h-4 w-4 text-neutral-500" />
        <h2 className="text-sm font-semibold text-neutral-900">Business context</h2>
      </div>
      <div className="space-y-4">
        {CARDS.map((c) => (
          <ContextField
            key={c.kind}
            engagementId={engagementId}
            kind={c.kind}
            title={c.title}
            hint={c.hint}
            initial={byKind.get(c.kind) ?? ""}
            canEdit={canEdit}
          />
        ))}
      </div>
    </div>
  );
}

function ContextField({
  engagementId,
  kind,
  title,
  hint,
  initial,
  canEdit,
}: {
  engagementId: string;
  kind: BusinessContextKind;
  title: string;
  hint: string;
  initial: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [body, setBody] = useState(initial);
  const dirty = body !== initial;

  function save() {
    startTransition(async () => {
      const result = await upsertBusinessContext(engagementId, kind, body);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Saved");
      router.refresh();
    });
  }

  return (
    <div>
      <div className="text-sm font-medium text-neutral-900">{title}</div>
      <div className="mb-1 text-xs text-neutral-500">{hint}</div>
      {canEdit ? (
        <>
          <textarea
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="(not filled in yet)"
            className="w-full rounded border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
          />
          {dirty && (
            <div className="mt-1 flex justify-end">
              <Button variant="outline" size="sm" onClick={save} disabled={isPending}>
                {isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          )}
        </>
      ) : (
        <p className="whitespace-pre-wrap text-sm text-neutral-700">
          {body || <span className="italic text-neutral-400">Not filled in yet.</span>}
        </p>
      )}
    </div>
  );
}
