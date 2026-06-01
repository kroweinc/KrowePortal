"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { draftPrd } from "@/lib/actions/prds";
import type { Question } from "@/lib/ai/schemas";

const OTHER = "__other__";

// Drop any AI-supplied option that is itself a generic "Other"/"please specify"
// catch-all, since the UI always appends its own canonical OTHER choice. Without
// this, such an option renders twice.
const isRealOption = (opt: string) => {
  const o = opt.trim().toLowerCase();
  return o !== "other" && !o.includes("specify");
};

type AnswerEntry = { questionId: string; question: string; answer: string };

type WizardState =
  | { kind: "intro" }
  | { kind: "loading"; label: string }
  | {
      kind: "questions";
      items: Question[];
      // One or more selected option values per question (OTHER is one of them).
      selections: Record<string, string[]>;
      otherText: Record<string, string>;
    };

interface Props {
  projectId: string;
  projectName: string;
  backHref: string;
  initialTitle: string;
}

export function PrdWizard({ projectId, projectName, backHref, initialTitle }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [title, setTitle] = useState(initialTitle);
  const [notes, setNotes] = useState("");
  const [round, setRound] = useState(0);
  const [answers, setAnswers] = useState<AnswerEntry[]>([]);
  const [state, setState] = useState<WizardState>({ kind: "intro" });
  // Cosmetic only — the server decides behavior from the (empty) notes each round.
  const [deepMode, setDeepMode] = useState(false);

  function run(nextAnswers: AnswerEntry[], nextRound: number, label: string) {
    setState({ kind: "loading", label });
    startTransition(async () => {
      const result = await draftPrd({
        projectId,
        title: title.trim() || `${projectName} — PRD`,
        notes: notes.trim() || undefined,
        answers: nextAnswers,
        round: nextRound,
      });

      if ("error" in result) {
        toast.error(result.error);
        // Return to the question screen if we were mid-interview, else intro.
        setState((prev) => (prev.kind === "loading" ? { kind: "intro" } : prev));
        return;
      }

      if (result.kind === "questions") {
        setState({
          kind: "questions",
          items: result.items,
          selections: Object.fromEntries(result.items.map((q) => [q.id, [] as string[]])),
          otherText: Object.fromEntries(result.items.map((q) => [q.id, ""])),
        });
        return;
      }

      // Finished PRD — go to the editor.
      router.push(`${backHref}/prd/${result.prdId}`);
    });
  }

  function start() {
    if (!title.trim()) {
      toast.error("Give the PRD a title first.");
      return;
    }
    setDeepMode(!notes.trim());
    setAnswers([]);
    setRound(0);
    run([], 0, notes.trim() ? "Reading your notes…" : "Preparing questions…");
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
      const next = multi
        ? cur.includes(opt)
          ? cur.filter((x) => x !== opt)
          : [...cur, opt]
        : [opt];
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
    run(merged, nextRound, "Putting your PRD together…");
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
        <h1 className="text-2xl font-semibold text-neutral-900 mb-1 mt-3">New PRD</h1>
        <p className="text-sm text-neutral-500">
          Paste what you know — or nothing at all. The AI asks a few questions to fill the gaps, then drafts a full PRD you can edit.
        </p>
      </div>

      {state.kind === "intro" && (
        <div className="space-y-6">
          <section className="space-y-2">
            <label className="block text-sm font-medium text-neutral-900">PRD title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Lead management portal — PRD"
              className="w-full rounded border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
            />
          </section>

          <section className="space-y-2">
            <label className="block text-sm font-medium text-neutral-900">
              Notes <span className="font-normal text-neutral-400">(optional)</span>
            </label>
            <p className="text-xs text-neutral-500">
              What&apos;s the product, who&apos;s it for, what must it do? Messy is fine. Leave it blank to start with questions.
            </p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={14}
              placeholder={`e.g.\nCar dealership wants one place to track every incoming lead. Leads come from web form, calls, walk-ins, FB, AutoTrader. Manager needs to see who's assigned and follow-up status. Sales reps update their own leads. Wants reporting on response time. Must work on desktop + phone.`}
              className="w-full rounded border border-neutral-200 px-3 py-2 text-sm font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-neutral-400"
            />
          </section>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-100">
            <Button onClick={start}>
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
            <p className="text-sm font-medium text-neutral-800">
              {deepMode ? "Building the context" : "A few questions to sharpen the PRD"}
            </p>
            <p className="text-xs text-neutral-500 mt-0.5">
              {deepMode
                ? `Round ${round + 1} — starting broad, then getting specific so your PRD is accurate. Pick the closest option or type your own.`
                : `Round ${round + 1} — answering these fills the PRD so nothing is left open. Pick the closest option or type your own.`}
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
                          <span className="leading-snug">{opt === OTHER ? "Other (specify)" : opt}</span>
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
