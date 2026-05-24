"use client";

import { useState, useTransition, useRef } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  generateSubtaskDrafts,
  acceptGeneratedSubtasks,
} from "@/lib/actions/ai-subtasks";
import type { Subtask } from "@/lib/types";
import type { Question, SubtaskDraft } from "@/lib/ai/schemas";

const OTHER = "__other__";

type DialogState =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "questions";
      items: Question[];
      selections: Record<string, string>;
      otherText: Record<string, string>;
    }
  | { kind: "drafts"; items: SubtaskDraft[]; selected: Set<number>; edited: Record<number, string> }
  | { kind: "accepting" };

interface Props {
  taskId: string;
  onAccept: (subtasks: Subtask[]) => void;
}

export function AiSubtaskGeneratorDialog({ taskId, onAccept }: Props) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<DialogState>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();
  const askedOnceRef = useRef(false);

  function openDialog() {
    askedOnceRef.current = false;
    setState({ kind: "idle" });
    setOpen(true);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      askedOnceRef.current = false;
      setState({ kind: "idle" });
    }
    setOpen(next);
  }

  function generate(answers?: { questionId: string; answer: string }[]) {
    setState({ kind: "loading" });
    startTransition(async () => {
      const result = await generateSubtaskDrafts({ taskId, answers });

      if ("error" in result) {
        toast.error(result.error);
        setState({ kind: "idle" });
        return;
      }

      if (result.kind === "questions") {
        if (askedOnceRef.current) {
          toast.error("Couldn't break this task down — try adding more detail to the task description and run again.");
          setState({ kind: "idle" });
          return;
        }
        askedOnceRef.current = true;
        setState({
          kind: "questions",
          items: result.items,
          selections: Object.fromEntries(result.items.map((q) => [q.id, ""])),
          otherText: Object.fromEntries(result.items.map((q) => [q.id, ""])),
        });
      } else {
        setState({
          kind: "drafts",
          items: result.items,
          selected: new Set(result.items.map((_, i) => i)),
          edited: {},
        });
      }
    });
  }

  function answerFor(q: Question, selections: Record<string, string>, otherText: Record<string, string>): string {
    const sel = selections[q.id] ?? "";
    if (sel === OTHER) return (otherText[q.id] ?? "").trim();
    return sel;
  }

  function submitAnswers() {
    if (state.kind !== "questions") return;
    const answers = state.items.map((q) => ({
      questionId: q.id,
      answer: answerFor(q, state.selections, state.otherText),
    }));
    generate(answers);
  }

  const questionsReady =
    state.kind === "questions" &&
    state.items.every((q) => answerFor(q, state.selections, state.otherText).length > 0);

  function accept() {
    if (state.kind !== "drafts") return;
    const draftsState = state;
    const drafts = [...draftsState.selected]
      .sort((a, b) => a - b)
      .map((i) => ({ title: draftsState.edited[i] ?? draftsState.items[i].title }));

    if (drafts.length === 0) {
      toast.error("Select at least one subtask to add.");
      return;
    }

    setState({ kind: "accepting" });
    startTransition(async () => {
      const result = await acceptGeneratedSubtasks(taskId, drafts);
      if (result.error) {
        toast.error(result.error);
        setState(draftsState);
        return;
      }
      onAccept(result.inserted);
      setOpen(false);
      setState({ kind: "idle" });
      toast.success(`Added ${result.inserted.length} subtask${result.inserted.length === 1 ? "" : "s"}`);
    });
  }

  const isLoading = state.kind === "loading" || state.kind === "accepting" || isPending;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-xs text-neutral-400 hover:text-neutral-700"
        onClick={openDialog}
        title="Generate subtasks with AI"
      >
        <Sparkles className="mr-1 h-3 w-3" />
        AI
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col" aria-describedby={undefined}>
          {state.kind === "idle" && (
            <>
              <DialogHeader>
                <DialogTitle>Generate subtasks with AI</DialogTitle>
              </DialogHeader>
              <div className="px-6 py-4 text-sm text-neutral-600">
                AI will read this task and the linked GitHub repo to suggest concrete subtasks. If the task needs clarification, it will ask a few questions first.
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={() => generate()}>
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  Generate
                </Button>
              </DialogFooter>
            </>
          )}

          {state.kind === "loading" && (
            <>
              <DialogHeader>
                <DialogTitle>Generating…</DialogTitle>
              </DialogHeader>
              <div className="flex items-center justify-center px-6 py-10">
                <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
              </div>
            </>
          )}

          {state.kind === "questions" && (
            <>
              <DialogHeader>
                <DialogTitle>A few questions first</DialogTitle>
              </DialogHeader>
              <div className="space-y-5 px-6 py-4 flex-1 min-h-0 overflow-y-auto">
                {state.items.map((q) => {
                  const selected = state.selections[q.id] ?? "";
                  return (
                    <div key={q.id} className="space-y-2">
                      <p className="text-sm font-medium text-neutral-800">{q.text}</p>
                      <div className="space-y-1.5">
                        {q.options.map((opt) => (
                          <label
                            key={opt}
                            className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm transition ${
                              selected === opt
                                ? "border-neutral-700 bg-neutral-50 text-neutral-900"
                                : "border-neutral-200 text-neutral-700 hover:border-neutral-300"
                            }`}
                          >
                            <input
                              type="radio"
                              name={q.id}
                              value={opt}
                              checked={selected === opt}
                              onChange={() =>
                                setState((prev) =>
                                  prev.kind === "questions"
                                    ? { ...prev, selections: { ...prev.selections, [q.id]: opt } }
                                    : prev
                                )
                              }
                              className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-neutral-700"
                            />
                            <span className="leading-snug">{opt}</span>
                          </label>
                        ))}
                        <label
                          className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm transition ${
                            selected === OTHER
                              ? "border-neutral-700 bg-neutral-50 text-neutral-900"
                              : "border-neutral-200 text-neutral-700 hover:border-neutral-300"
                          }`}
                        >
                          <input
                            type="radio"
                            name={q.id}
                            value={OTHER}
                            checked={selected === OTHER}
                            onChange={() =>
                              setState((prev) =>
                                prev.kind === "questions"
                                  ? { ...prev, selections: { ...prev.selections, [q.id]: OTHER } }
                                  : prev
                              )
                            }
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-neutral-700"
                          />
                          <span className="leading-snug">Other (specify)</span>
                        </label>
                        {selected === OTHER && (
                          <textarea
                            rows={2}
                            autoFocus
                            value={state.otherText[q.id] ?? ""}
                            onChange={(e) =>
                              setState((prev) =>
                                prev.kind === "questions"
                                  ? { ...prev, otherText: { ...prev.otherText, [q.id]: e.target.value } }
                                  : prev
                              )
                            }
                            placeholder="Type your answer…"
                            className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-neutral-400 resize-none"
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setState({ kind: "idle" })}>Back</Button>
                <Button onClick={submitAnswers} disabled={isLoading || !questionsReady}>
                  {isLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                  Generate subtasks
                </Button>
              </DialogFooter>
            </>
          )}

          {state.kind === "drafts" && (
            <>
              <DialogHeader>
                <DialogTitle>Proposed subtasks</DialogTitle>
              </DialogHeader>
              <div className="space-y-1 px-6 py-4 flex-1 min-h-0 overflow-y-auto">
                <p className="mb-3 text-xs text-neutral-500">
                  Uncheck or edit any subtask before adding. All are selected by default.
                </p>
                {state.items.map((draft, i) => (
                  <div key={i} className="flex items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-neutral-50">
                    <input
                      type="checkbox"
                      checked={state.selected.has(i)}
                      onChange={() =>
                        setState((prev) => {
                          if (prev.kind !== "drafts") return prev;
                          const next = new Set(prev.selected);
                          if (next.has(i)) next.delete(i); else next.add(i);
                          return { ...prev, selected: next };
                        })
                      }
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-neutral-700 cursor-pointer"
                    />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <input
                        value={state.edited[i] ?? draft.title}
                        onChange={(e) =>
                          setState((prev) =>
                            prev.kind === "drafts"
                              ? { ...prev, edited: { ...prev.edited, [i]: e.target.value } }
                              : prev
                          )
                        }
                        className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-neutral-800 outline-none focus:border-neutral-300 focus:bg-white"
                      />
                      {draft.rationale && (
                        <p className="px-1 text-xs text-neutral-400">{draft.rationale}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => generate()}>Regenerate</Button>
                <Button onClick={accept} disabled={isLoading || state.selected.size === 0}>
                  {isLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                  Add {state.selected.size > 0 ? state.selected.size : ""} subtask{state.selected.size === 1 ? "" : "s"}
                </Button>
              </DialogFooter>
            </>
          )}

          {state.kind === "accepting" && (
            <>
              <DialogHeader>
                <DialogTitle>Saving…</DialogTitle>
              </DialogHeader>
              <div className="flex items-center justify-center px-6 py-10">
                <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
