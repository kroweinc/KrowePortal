"use client";

/* Quote creation wizard. Three creation paths (the "many ways"):
   • From a PRD   — pick one of the project's PRDs; AI prices it.
   • From scratch — recommended-option interview (deep context), no source.
   • From notes   — paste discovery notes; AI asks a couple questions then prices.
   After the path, it mirrors the PRD wizard's question loop (recommended option
   pre-selected, multi-select, "Other"), then redirects to the quote dashboard. */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Sparkles, Loader2, FileText, PenLine, NotebookPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { draftQuote, type DraftQuoteInput } from "@/lib/actions/quote-docs";
import type { Question } from "@/lib/ai/schemas";

const OTHER = "__other__";

const isRealOption = (opt: string) => {
  const o = opt.trim().toLowerCase();
  return o !== "other" && !o.includes("specify");
};

const matchesRecommended = (opt: string, rec?: string) =>
  !!rec && opt.trim().toLowerCase() === rec.trim().toLowerCase();

type Source = "prd" | "scratch" | "notes";
type AnswerEntry = { questionId: string; question: string; answer: string };

type WizardState =
  | { kind: "path" }
  | { kind: "prd" }
  | { kind: "notes" }
  | { kind: "loading"; label: string }
  | {
      kind: "questions";
      items: Question[];
      selections: Record<string, string[]>;
      otherText: Record<string, string>;
    };

export interface WizardPrd {
  id: string;
  title: string;
  status: string;
}

interface Props {
  projectId: string;
  projectName: string;
  backHref: string;
  initialTitle: string;
  prds: WizardPrd[];
  initialPrdId?: string | null;
}

export function QuoteWizard({ projectId, projectName, backHref, initialTitle, prds, initialPrdId }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [title, setTitle] = useState(initialTitle);
  const [source, setSource] = useState<Source>(initialPrdId ? "prd" : "scratch");
  const [prdId, setPrdId] = useState<string | null>(initialPrdId ?? null);
  const [notes, setNotes] = useState("");
  const [round, setRound] = useState(0);
  const [answers, setAnswers] = useState<AnswerEntry[]>([]);
  const [state, setState] = useState<WizardState>(initialPrdId ? { kind: "prd" } : { kind: "path" });

  function run(src: Source, srcPrdId: string | null, nextAnswers: AnswerEntry[], nextRound: number, label: string) {
    setState({ kind: "loading", label });
    const payload: DraftQuoteInput = {
      projectId,
      title: title.trim() || `${projectName} — Quote`,
      source: src,
      sourcePrdId: src === "prd" ? srcPrdId ?? undefined : undefined,
      notes: src === "notes" ? notes.trim() || undefined : undefined,
      answers: nextAnswers,
      round: nextRound,
    };
    // Where to land if the draft fails — the path's own entry point.
    const entryState: WizardState =
      src === "prd" ? { kind: "prd" } : src === "notes" ? { kind: "notes" } : { kind: "path" };

    startTransition(async () => {
      try {
        const result = await draftQuote(payload);

        if ("error" in result) {
          toast.error(result.error);
          setState(entryState);
          return;
        }

        if (result.kind === "questions") {
          setState({
            kind: "questions",
            items: result.items,
            selections: Object.fromEntries(
              result.items.map((q) => [
                q.id,
                q.recommended && q.options.some((o) => matchesRecommended(o, q.recommended)) ? [q.recommended] : [],
              ])
            ),
            otherText: Object.fromEntries(result.items.map((q) => [q.id, ""])),
          });
          return;
        }

        router.push(`${backHref}/quotes/${result.quoteId}`);
      } catch (err) {
        // A thrown/rejected server action (network drop, timeout) must never
        // leave the wizard stuck on the spinner with no feedback or escape.
        toast.error(err instanceof Error ? err.message : "Something went wrong generating the quote.");
        setState(entryState);
      }
    });
  }

  function startPath(src: Source, srcPrdId?: string | null) {
    if (!title.trim()) {
      toast.error("Give the quote a title first.");
      return;
    }
    setSource(src);
    setPrdId(srcPrdId ?? null);
    setAnswers([]);
    setRound(0);
    const label =
      src === "prd"
        ? "Pricing the PRD…"
        : src === "notes" && notes.trim()
        ? "Reading your notes…"
        : "Preparing questions…";
    run(src, srcPrdId ?? null, [], 0, label);
  }

  function answerFor(q: Question, selections: Record<string, string[]>, otherText: Record<string, string>): string {
    const sel = selections[q.id] ?? [];
    const parts: string[] = [];
    for (const s of sel) {
      if (s === OTHER) {
        const t = (otherText[q.id] ?? "").trim();
        if (t) parts.push(t);
      } else {
        parts.push(s);
      }
    }
    return parts.join(", ");
  }

  function toggleOption(qId: string, opt: string, multi: boolean) {
    setState((prev) => {
      if (prev.kind !== "questions") return prev;
      const cur = prev.selections[qId] ?? [];
      const next = multi ? (cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt]) : [opt];
      return { ...prev, selections: { ...prev.selections, [qId]: next } };
    });
  }

  function submitAnswers() {
    if (state.kind !== "questions") return;
    const roundAnswers: AnswerEntry[] = state.items.map((q) => ({
      questionId: q.id,
      question: q.text,
      answer: answerFor(q, state.selections, state.otherText),
    }));
    const merged = [...answers, ...roundAnswers];
    const nextRound = round + 1;
    setAnswers(merged);
    setRound(nextRound);
    run(source, prdId, merged, nextRound, "Putting your quote together…");
  }

  const questionsReady =
    state.kind === "questions" &&
    state.items.every((q) => answerFor(q, state.selections, state.otherText).length > 0);

  return (
    <div className="space-y-6">
      <div>
        <Link href={backHref} className="text-xs text-neutral-500 hover:text-neutral-900">
          ← {projectName}
        </Link>
        <h1 className="text-2xl font-semibold text-neutral-900 mb-1 mt-3">New quote</h1>
        <p className="text-sm text-neutral-500">
          Generate a priced breakdown from a PRD, from scratch, or from notes. AI estimates the numbers; you edit anything before sending.
        </p>
      </div>

      {(state.kind === "path" || state.kind === "prd" || state.kind === "notes") && (
        <section className="space-y-2">
          <label className="block text-sm font-medium text-neutral-900">Quote title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. AI Calls MVP — Quote"
            className="w-full rounded border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
          />
        </section>
      )}

      {state.kind === "path" && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-neutral-800">How do you want to start?</p>
          <button
            type="button"
            onClick={() => (prds.length ? setState({ kind: "prd" }) : toast.error("No PRDs in this document yet."))}
            disabled={!prds.length}
            className="flex w-full items-start gap-3 rounded-lg border border-neutral-200 px-4 py-3 text-left transition hover:border-neutral-300 disabled:opacity-50"
          >
            <FileText className="mt-0.5 h-5 w-5 text-neutral-500" />
            <span>
              <span className="block text-sm font-medium text-neutral-900">From a PRD</span>
              <span className="block text-xs text-neutral-500">
                {prds.length ? "Price an existing PRD in this document." : "No PRDs yet — create one first."}
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => startPath("scratch")}
            className="flex w-full items-start gap-3 rounded-lg border border-neutral-200 px-4 py-3 text-left transition hover:border-neutral-300"
          >
            <PenLine className="mt-0.5 h-5 w-5 text-neutral-500" />
            <span>
              <span className="block text-sm font-medium text-neutral-900">From scratch</span>
              <span className="block text-xs text-neutral-500">Answer a few questions and the AI builds the quote.</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setState({ kind: "notes" })}
            className="flex w-full items-start gap-3 rounded-lg border border-neutral-200 px-4 py-3 text-left transition hover:border-neutral-300"
          >
            <NotebookPen className="mt-0.5 h-5 w-5 text-neutral-500" />
            <span>
              <span className="block text-sm font-medium text-neutral-900">From notes</span>
              <span className="block text-xs text-neutral-500">
                Paste discovery notes or a rough scope — or leave blank to answer questions.
              </span>
            </span>
          </button>
        </div>
      )}

      {state.kind === "prd" && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-neutral-800">Pick the PRD to price</p>
          <div className="space-y-2">
            {prds.map((p) => (
              <label
                key={p.id}
                className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition ${
                  prdId === p.id
                    ? "border-neutral-700 bg-neutral-50 text-neutral-900"
                    : "border-neutral-200 text-neutral-700 hover:border-neutral-300"
                }`}
              >
                <input
                  type="radio"
                  name="prd"
                  checked={prdId === p.id}
                  onChange={() => setPrdId(p.id)}
                  className="h-3.5 w-3.5 accent-neutral-700"
                />
                <span className="flex-1">{p.title}</span>
                <span className="text-xs uppercase tracking-wide text-neutral-400">{p.status}</span>
              </label>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-neutral-100">
            <Button variant="outline" onClick={() => setState({ kind: "path" })}>
              Back
            </Button>
            <Button onClick={() => startPath("prd", prdId)} disabled={!prdId}>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              Generate quote
            </Button>
          </div>
        </div>
      )}

      {state.kind === "notes" && (
        <div className="space-y-3">
          <label className="block text-sm font-medium text-neutral-900">
            Notes <span className="font-normal text-neutral-400">(optional)</span>
          </label>
          <p className="text-xs text-neutral-500">
            What&apos;s the product, which modules, rough budget? Messy is fine. Leave it blank to start with questions instead.
          </p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={12}
            placeholder={`e.g.\nThree connected tools: an internal Business OS, an AI phone assistant, and a social media content generator. Budget around $6–8k. Needs auth, task manager, call logging, Calendly booking.`}
            className="w-full rounded border border-neutral-200 px-3 py-2 text-sm font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-neutral-400"
          />
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-neutral-100">
            <Button variant="outline" onClick={() => setState({ kind: "path" })}>
              Back
            </Button>
            <Button onClick={() => startPath("notes")}>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              {notes.trim() ? "Start drafting" : "Start with questions"}
            </Button>
          </div>
        </div>
      )}

      {state.kind === "loading" && (
        <div className="flex flex-col items-center justify-center gap-3 py-20">
          <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
          <p className="text-sm text-neutral-500">{state.label}</p>
        </div>
      )}

      {state.kind === "questions" && (
        <div className="space-y-6">
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
            <p className="text-sm font-medium text-neutral-800">A few questions to price the work</p>
            <p className="text-xs text-neutral-500 mt-0.5">
              Round {round + 1} — pick the closest option or type your own. The AI uses these to estimate the breakdown.
            </p>
          </div>

          <div className="space-y-6">
            {state.items.map((q) => {
              const selected = state.selections[q.id] ?? [];
              const multi = q.multiSelect;
              const isOn = (opt: string) => selected.includes(opt);
              return (
                <div key={q.id} className="space-y-2">
                  <p className="text-sm font-medium text-neutral-800">
                    {q.text}
                    {multi && <span className="ml-1.5 font-normal text-neutral-400">(select all that apply)</span>}
                  </p>
                  <div className="space-y-1.5">
                    {[...q.options.filter(isRealOption), OTHER].map((opt) => {
                      const on = isOn(opt);
                      const isRecommended = matchesRecommended(opt, q.recommended);
                      return (
                        <label
                          key={opt}
                          className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm transition ${
                            on
                              ? "border-neutral-700 bg-neutral-50 text-neutral-900"
                              : "border-neutral-200 text-neutral-700 hover:border-neutral-300"
                          }`}
                        >
                          <input
                            type={multi ? "checkbox" : "radio"}
                            name={q.id}
                            value={opt}
                            checked={on}
                            onChange={() => toggleOption(q.id, opt, multi)}
                            className={`mt-0.5 h-3.5 w-3.5 shrink-0 accent-neutral-700 ${multi ? "rounded" : ""}`}
                          />
                          <span className="flex-1 leading-snug">
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span>{opt === OTHER ? "Other (specify)" : opt}</span>
                              {isRecommended && (
                                <span className="rounded-full border border-neutral-300 bg-white px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-600">
                                  Recommended
                                </span>
                              )}
                            </span>
                            {isRecommended && q.recommendation && (
                              <span className="mt-0.5 block text-xs font-normal text-neutral-500">{q.recommendation}</span>
                            )}
                          </span>
                        </label>
                      );
                    })}
                    {isOn(OTHER) && (
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

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-100">
            <Button onClick={submitAnswers} disabled={!questionsReady}>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              Continue
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
