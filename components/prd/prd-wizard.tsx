"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Pencil,
  Minus,
  Sparkles,
  Loader2,
  FileUp,
  FileText,
  Captions,
  ClipboardList,
  AudioLines,
  X,
  Plus,
  Check,
  Lock,
  type LucideIcon,
} from "lucide-react";
import { draftPrd } from "@/lib/actions/prds";
import {
  addSopTranscriptText,
  uploadSopTranscript,
  deleteSopTranscript,
} from "@/lib/actions/project-sop";
import { SOP_ACCEPT, MAX_SOP_CHARS } from "@/lib/attachments-constants";
import type { Question } from "@/lib/ai/schemas";
import type { ProjectSopTranscript } from "@/lib/types";

const OTHER = "__other__";

// Drop any AI-supplied option that is itself a generic "Other"/"please specify"
// catch-all, since the UI always appends its own canonical OTHER choice. Without
// this, such an option renders twice.
const isRealOption = (opt: string) => {
  const o = opt.trim().toLowerCase();
  return o !== "other" && !o.includes("specify");
};

// Tolerant match between an option string and the AI's `recommended` value
// (handles whitespace/case). A `recommended` that matches no option yields no
// badge — never an error — so a stray value can't break the round.
const matchesRecommended = (opt: string, rec?: string) =>
  !!rec && opt.trim().toLowerCase() === rec.trim().toLowerCase();

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
      // Index of the question currently shown (one-at-a-time editorial flow).
      // Reset to 0 on every new round, so it can never desync from `items`.
      cursor: number;
    };

// ── SOP transcript display helpers ───────────────────────────────────────
// Map a stored transcript to its display kind + icon, mirroring the design's
// per-extension treatment (captions, pdf, doc, audio, plain transcript).
function kindFor(t: ProjectSopTranscript): { kind: string; Icon: LucideIcon } {
  if (t.source_type === "paste") return { kind: "Pasted", Icon: ClipboardList };
  const ext = (t.file_name?.split(".").pop() ?? "").toLowerCase();
  if (ext === "vtt" || ext === "srt") return { kind: "Caption", Icon: Captions };
  if (ext === "pdf") return { kind: "PDF", Icon: FileText };
  if (ext === "docx" || ext === "doc") return { kind: "Doc", Icon: FileText };
  if (ext === "mp3" || ext === "m4a" || ext === "wav") return { kind: "Audio", Icon: AudioLines };
  return { kind: "Transcript", Icon: FileText };
}

function formatCount(n: number | null): string {
  if (!n) return "";
  if (n < 1000) return `${n} chars`;
  return `${Math.round(n / 1000)}k chars`;
}

function sopName(t: ProjectSopTranscript): string {
  return t.label || t.file_name || "Pasted transcript";
}

const Ember = ({ size = 15 }: { size?: number }) => (
  <span className="ember">
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill="var(--primary)" opacity="0.2" />
      <circle cx="8" cy="8" r="4" fill="var(--primary)" opacity="0.4" />
      <circle cx="8" cy="8" r="2.5" fill="var(--primary)" />
      <circle cx="9" cy="7" r="1" fill="var(--primary-accent)" />
    </svg>
  </span>
);

// ── Editorial (Direction B) interview helpers ────────────────────────────
// A fact row in the live "PRD taking shape" doc on the left stage.
type Fact = { key: string; label: string; value: string; status: "done" | "active" | "pending" };

// Real Question ids are server-generated and not human-friendly, and there is
// no short-label field, so derive a compact eyebrow from the question text
// (CSS uppercases it). First ~5 words, trailing punctuation stripped.
function factLabel(text: string): string {
  const cleaned = text.replace(/[?:.]+$/g, "").trim();
  return cleaned.split(/\s+/).slice(0, 5).join(" ");
}

// Segmented progress track + mono counter (mirrors the design's WzProgress).
function WzProgress({ label, index, total }: { label: string; index: number; total: number }) {
  return (
    <div className="wz-progress">
      <div className="wz-progress-top">
        <span className="wz-progress-label">
          <Ember size={13} />
          {label}
        </span>
        <span className="wz-progress-count">
          <b>{String(Math.min(index + 1, total)).padStart(2, "0")}</b> / {String(total).padStart(2, "0")}
        </span>
      </div>
      <div className="wz-progress-track">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={`wz-progress-seg ${i < index ? "done" : i === index ? "cur" : ""}`} />
        ))}
      </div>
    </div>
  );
}

// Left "stage" — the PRD doc filling in as the builder answers.
function DraftStage({ facts, docTitle, docMeta }: { facts: Fact[]; docTitle: string; docMeta: string }) {
  return (
    <section className="ed-stage">
      <div className="ed-stage-head">
        <span className="ed-stage-eyebrow">
          <Ember size={14} />
          The draft
        </span>
      </div>
      <div className="ed-stage-body">
        <h2 className="ed-stage-h">Your PRD, taking shape.</h2>
        <div className="ed-doc">
          <div className="ed-doc-top">
            <span className="ed-doc-title">{docTitle}</span>
            <span className="ed-doc-meta">{docMeta}</span>
          </div>
          <div className="ed-fill">
            {facts.map((f) => (
              <div key={f.key} className={`ed-fact ${f.status}`}>
                <span className="ed-fact-k">
                  {f.status === "done" ? (
                    <Check size={12} strokeWidth={3} />
                  ) : f.status === "active" ? (
                    <Pencil size={12} strokeWidth={2} />
                  ) : (
                    <Minus size={12} strokeWidth={2} />
                  )}
                </span>
                <div className="ed-fact-main">
                  <div className="ed-fact-label">{f.label}</div>
                  <div className="ed-fact-val">{f.value || "Awaiting your answer"}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// Expected generation durations (ms) driving the progress estimate. The bar eases
// toward an asymptote, so finishing early just snaps to done — these are generous
// upper-ish guesses, deliberately set so the estimate under-promises. Tune by
// timing a few real runs once reasoning-effort tuning is live.
const EXPECTED_FIRST_MS = 9000; // round 0: reading notes / preparing questions
const EXPECTED_GENERATE_MS = 22000; // later rounds: may be the full PRD (the long one)

const PROGRESS_PHASES = ["Reading your answers", "Sizing the scope", "Writing requirements", "Finalizing"];

// m:ss for a duration in ms.
function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// "Putting it together" panel with an estimated time-progress bar. Shown in the
// right sheet (or the first-load spinner spot) while a round generates. The fill
// eases toward a 92% cap so it never sits at 100% before the server responds; the
// parent redirects/unmounts the instant generation resolves, which reads as done.
function WizLoading({ label, expectedMs }: { label: string; expectedMs: number }) {
  const [elapsed, setElapsed] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    setReduceMotion(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
    const start = Date.now();
    const t = setInterval(() => setElapsed(Date.now() - start), 250);
    return () => clearInterval(t);
  }, []);

  const ratio = elapsed / expectedMs;
  const pct = Math.min(92, (1 - Math.exp(-1.6 * ratio)) * 92);
  const over = elapsed >= expectedMs;
  // Phase thresholds: ≤25 / ≤55 / ≤85 / >85.
  const phaseIdx = pct <= 25 ? 0 : pct <= 55 ? 1 : pct <= 85 ? 2 : 3;

  return (
    <div className="prd-progress">
      <Ember size={40} />
      <p className="prd-progress-title">{label}</p>

      <div
        className="prd-progress-bar"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <span className={`prd-progress-fill ${reduceMotion ? "" : "shimmer"}`} style={{ width: `${pct}%` }} />
      </div>

      <div className="prd-progress-meta">
        <span>{fmtClock(elapsed)} elapsed</span>
        <span>{over ? "Taking a little longer than usual…" : `~${fmtClock(expectedMs - elapsed)} left`}</span>
      </div>

      <ul className="prd-progress-steps">
        {PROGRESS_PHASES.map((p, i) => {
          const status = i < phaseIdx ? "done" : i === phaseIdx ? "cur" : "pending";
          return (
            <li key={p} className={`prd-progress-step ${status}`}>
              <span className="prd-progress-ic">
                {status === "done" ? (
                  <Check size={12} strokeWidth={3} />
                ) : status === "cur" ? (
                  <Loader2 size={12} className={reduceMotion ? "" : "animate-spin"} />
                ) : null}
              </span>
              {p}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface Props {
  projectId: string;
  projectName: string;
  backHref: string;
  initialTitle: string;
  initialSopTranscripts: ProjectSopTranscript[];
}

export function PrdWizard({
  projectId,
  projectName,
  backHref,
  initialTitle,
  initialSopTranscripts,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [title, setTitle] = useState(initialTitle);
  const [notes, setNotes] = useState("");
  const [round, setRound] = useState(0);
  const [answers, setAnswers] = useState<AnswerEntry[]>([]);
  const [state, setState] = useState<WizardState>({ kind: "intro" });
  // Always points at the latest state so queued auto-advance timers and the
  // global keydown handler read fresh selections/cursor, never a stale closure.
  const stateRef = useRef(state);
  stateRef.current = state;
  // Pending single-select auto-advance timer.
  const advTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cosmetic only — the server decides behavior from the (empty) notes each round.
  const [deepMode, setDeepMode] = useState(false);

  // ── SOP transcripts: the project's already-uploaded discovery transcripts,
  // editable in place (upload / drag-drop / paste). They persist to the project
  // immediately and are pulled into PRD generation server-side at draft time.
  const [transcripts, setTranscripts] = useState<ProjectSopTranscript[]>(initialSopTranscripts);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteLabel, setPasteLabel] = useState("");
  const [sopPending, startSop] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function markNew(id: string) {
    setNewIds((prev) => new Set(prev).add(id));
  }

  function addFiles(fileList: FileList | null) {
    const selected = Array.from(fileList ?? []);
    if (!selected.length) return;
    startSop(async () => {
      for (const file of selected) {
        const fd = new FormData();
        fd.append("project_id", projectId);
        fd.append("file", file);
        const result = await uploadSopTranscript(fd);
        if (result.error || !result.transcript) {
          toast.error(`${file.name}: ${result.error ?? "upload failed"}`);
          continue;
        }
        const t = result.transcript;
        setTranscripts((prev) => [t, ...prev]);
        markNew(t.id);
      }
    });
  }

  function onFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    addFiles(e.target.files);
    e.target.value = "";
  }

  function savePaste() {
    const content = pasteText.trim();
    if (!content) {
      setPasting(false);
      setPasteText("");
      setPasteLabel("");
      return;
    }
    startSop(async () => {
      const result = await addSopTranscriptText(projectId, content, pasteLabel.trim() || undefined);
      if (result.error || !result.transcript) {
        toast.error(result.error ?? "Couldn't save transcript.");
        return;
      }
      const t = result.transcript;
      setTranscripts((prev) => [t, ...prev]);
      markNew(t.id);
      setPasteText("");
      setPasteLabel("");
      setPasting(false);
    });
  }

  function removeTranscript(id: string) {
    startSop(async () => {
      const result = await deleteSopTranscript(id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setTranscripts((prev) => prev.filter((t) => t.id !== id));
    });
  }

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
        // The model often reuses question ids ("q1", "q2") across rounds — and
        // occasionally within one round — which collides React keys and the
        // id-keyed selection/answer state (answering one question would bleed
        // into another). Reassign a globally-unique id per question; the id is
        // cosmetic (the server keys answers off question TEXT, not id).
        const items = result.items.map((q, i) => ({ ...q, id: `r${nextRound}q${i}` }));
        setState({
          kind: "questions",
          items,
          // Pre-select the AI's recommended option (when it matches a real
          // option) so the builder just confirms; fully overridable.
          selections: Object.fromEntries(
            items.map((q) => [
              q.id,
              q.recommended && q.options.some((o) => matchesRecommended(o, q.recommended))
                ? [q.recommended]
                : ([] as string[]),
            ])
          ),
          otherText: Object.fromEntries(items.map((q) => [q.id, ""])),
          cursor: 0,
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
    const s = stateRef.current;
    if (s.kind !== "questions") return;
    const roundAnswers: AnswerEntry[] = s.items.map((q) => ({
      questionId: q.id,
      question: q.text,
      answer: answerFor(q, s.selections, s.otherText),
    }));
    const merged = [...answers, ...roundAnswers];
    const nextRound = round + 1;
    setAnswers(merged);
    setRound(nextRound);
    run(merged, nextRound, "Putting your PRD together…");
  }

  function clearAdvTimer() {
    if (advTimer.current) {
      clearTimeout(advTimer.current);
      advTimer.current = null;
    }
  }

  // Advance to the next question, or submit the whole round on the last one.
  // Reads the latest state via stateRef so a queued auto-advance never acts on
  // stale selections.
  function goToNext() {
    clearAdvTimer();
    const s = stateRef.current;
    if (s.kind !== "questions") return;
    if (s.cursor < s.items.length - 1) {
      setState((prev) => (prev.kind === "questions" ? { ...prev, cursor: prev.cursor + 1 } : prev));
    } else {
      submitAnswers();
    }
  }

  // Back one question; on the first question, leave the wizard (never silently
  // drop already-merged answers from prior rounds).
  function goToPrev() {
    clearAdvTimer();
    const s = stateRef.current;
    if (s.kind !== "questions") return;
    if (s.cursor > 0) {
      setState((prev) => (prev.kind === "questions" ? { ...prev, cursor: prev.cursor - 1 } : prev));
    } else {
      router.push(backHref);
    }
  }

  // Pick an option. Single-select auto-advances ~440ms after the choice;
  // multi-select toggles and waits for an explicit Next.
  function pickOption(opt: string) {
    clearAdvTimer();
    const s = stateRef.current;
    if (s.kind !== "questions") return;
    const q = s.items[s.cursor];
    if (!q) return;
    toggleOption(q.id, opt, q.multiSelect);
    if (!q.multiSelect && opt !== OTHER) {
      advTimer.current = setTimeout(goToNext, 440);
    }
  }

  // Keyboard interview controls: 1–N pick, Enter advances when answered,
  // ← goes back. Mounted only during the questions phase, and never hijacks
  // typing in the "Something else" textarea.
  useEffect(() => {
    if (state.kind !== "questions") return;
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el) {
        const tag = el.tagName;
        if (tag === "TEXTAREA" || tag === "SELECT") return;
        if (tag === "INPUT") {
          const type = (el as HTMLInputElement).type;
          if (type !== "radio" && type !== "checkbox") return;
        }
      }
      const s = stateRef.current;
      if (s.kind !== "questions") return;
      const q = s.items[s.cursor];
      if (!q) return;
      const opts = [...q.options.filter(isRealOption), OTHER];
      const n = parseInt(e.key, 10);
      if (!Number.isNaN(n) && n >= 1 && n <= opts.length) {
        e.preventDefault();
        const opt = opts[n - 1];
        if (opt === OTHER) toggleOption(q.id, OTHER, q.multiSelect);
        else pickOption(opt);
      } else if (e.key === "Enter") {
        if (answerFor(q, s.selections, s.otherText).length > 0) {
          e.preventDefault();
          goToNext();
        }
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goToPrev();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind]);

  // Clear any pending auto-advance timer on unmount.
  useEffect(
    () => () => {
      if (advTimer.current) clearTimeout(advTimer.current);
    },
    []
  );

  const hasNotes = notes.trim().length > 0;

  return (
    <div className="prdnew">
      <Link href={backHref} className="crumb">
        <span className="ci">
          <ArrowLeft size={15} strokeWidth={2} />
        </span>
        {projectName}
      </Link>

      <h1 className="page-title">New PRD</h1>

      {state.kind === "intro" && (
        <>
          <p className="page-lede">
            Paste what you know — or nothing at all. Krowe asks a few questions to fill the gaps, then
            drafts a full PRD you can edit.
          </p>

          <div className="field">
            <label className="field-label" htmlFor="prd-title">
              PRD title
            </label>
            <input
              id="prd-title"
              className="text-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Lead management portal — PRD"
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="prd-notes">
              Notes <span className="opt">(optional)</span>
            </label>
            <p className="field-help">
              What&apos;s the product, who&apos;s it for, what must it do? Leave it blank to start with
              questions.
            </p>
            <textarea
              id="prd-notes"
              className="notes-area"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                "Car dealership wants one place to track every incoming lead — web form, calls, walk-ins, FB, AutoTrader. Manager sees who's assigned and follow-up status; reps update their own leads. Desktop + phone."
              }
            />
            <div className="notes-foot">
              <span className="field-note">Messy is fine. A sentence or two does the job.</span>
              <span className="notes-count">
                {notes.trim() ? `${notes.trim().split(/\s+/).length} words` : ""}
              </span>
            </div>
          </div>

          {/* ── SOP transcripts ─────────────────────────────────────────── */}
          <section className="sop">
            <div className="sop-head">
              <span className="field-label">
                SOP transcripts <span className="opt">(optional)</span>
              </span>
              <Ember size={15} />
            </div>
            <p className="field-help">
              Recordings or transcripts of how the work actually gets done — onboarding calls, a
              walkthrough of the returns desk, a Loom of the daily close. Krowe reads these to ground the
              PRD in real operations, not assumptions.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={SOP_ACCEPT}
              style={{ display: "none" }}
              onChange={onFilesSelected}
            />

            <div
              className={`dropzone ${drag ? "drag" : ""}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                addFiles(e.dataTransfer.files);
              }}
            >
              <span className="dz-ic">
                <FileUp size={19} strokeWidth={1.9} />
              </span>
              <span className="dz-strong">
                Drop transcripts here, or <u>browse</u>
              </span>
              <span className="dz-sub">.txt · .vtt · .docx · .pdf · audio — up to 25 MB each</span>
            </div>

            {transcripts.length > 0 && (
              <div className="sop-rows">
                {transcripts.map((t) => {
                  const { kind, Icon } = kindFor(t);
                  const count = formatCount(t.char_count);
                  return (
                    <div key={t.id} className={`sop-row ${newIds.has(t.id) ? "is-new" : ""}`}>
                      <span className="sop-ico">
                        <Icon size={17} strokeWidth={1.9} />
                      </span>
                      <div className="sop-main">
                        <div className="sop-titleline">
                          <span className="sop-name">{sopName(t)}</span>
                          <span className="chip-kind">{kind}</span>
                          <span className="chip-kind chip-ready">Ready</span>
                        </div>
                        {count && (
                          <div className="sop-sub">
                            <span>{count}</span>
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        className="sop-x"
                        title="Remove"
                        disabled={sopPending}
                        onClick={() => removeTranscript(t.id)}
                      >
                        <X size={16} strokeWidth={2} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {pasting ? (
              <div className="paste-box">
                <input
                  className="paste-label"
                  value={pasteLabel}
                  onChange={(e) => setPasteLabel(e.target.value)}
                  placeholder="Label (optional) — e.g. Discovery call, Jun 10"
                />
                <textarea
                  className="paste-area"
                  autoFocus
                  maxLength={MAX_SOP_CHARS}
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder={
                    "Paste a transcript or SOP write-up…\n\n[00:02] Manager: When a return comes in, first thing we do is check the receipt against the system…"
                  }
                />
                <div className="paste-foot">
                  <span className="notes-count">
                    {pasteText.length.toLocaleString()} / {MAX_SOP_CHARS.toLocaleString()} chars
                  </span>
                  <div className="paste-actions">
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{ height: 34 }}
                      disabled={sopPending}
                      onClick={() => {
                        setPasting(false);
                        setPasteText("");
                        setPasteLabel("");
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="add-mini"
                      style={{ borderStyle: "solid", background: "white" }}
                      disabled={sopPending}
                      onClick={savePaste}
                    >
                      <span className="ai">
                        <Check size={14} strokeWidth={2.25} />
                      </span>
                      Save transcript
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="add-row">
                <button
                  type="button"
                  className="add-mini"
                  disabled={sopPending}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <span className="ai">
                    <Plus size={14} strokeWidth={2} />
                  </span>
                  Upload transcript
                </button>
                <button
                  type="button"
                  className="add-mini"
                  disabled={sopPending}
                  onClick={() => setPasting(true)}
                >
                  <span className="ai">
                    <ClipboardList size={14} strokeWidth={2} />
                  </span>
                  Paste transcript
                </button>
                {sopPending && (
                  <span className="foot-hint">
                    <Loader2 size={13} className="animate-spin" /> Working…
                  </span>
                )}
              </div>
            )}
          </section>

          <div className="form-foot">
            <span className="foot-hint">
              <span className="fi">
                <Lock size={13} strokeWidth={2} />
              </span>
              Notes and transcripts stay private to this engagement.
            </span>
            <div className="cta-group">
              <button className="btn-primary" onClick={start}>
                <Sparkles size={15} strokeWidth={2} />
                {hasNotes ? "Start drafting" : "Start with questions"}
              </button>
            </div>
          </div>
        </>
      )}

      {state.kind === "loading" &&
        (answers.length > 0 ? (
          // Mid-interview: keep the editorial overlay up with the draft visible
          // on the left while the next round (or the final PRD) generates.
          <div className="ed">
            <DraftStage
              facts={answers.map((a) => ({
                key: a.questionId,
                label: factLabel(a.question),
                value: a.answer,
                status: "done" as const,
              }))}
              docTitle={title.trim() || `${projectName} — PRD`}
              docMeta={projectName.toUpperCase()}
            />
            <section className="ed-sheet">
              <div className="ed-sheet-body">
                <div className="ed-sheet-inner">
                  <WizLoading label={state.label} expectedMs={EXPECTED_GENERATE_MS} />
                </div>
              </div>
            </section>
          </div>
        ) : (
          // First load (no answers yet): in-page progress meter.
          <div className="prd-loading">
            <WizLoading label={state.label} expectedMs={EXPECTED_FIRST_MS} />
          </div>
        ))}

      {state.kind === "questions" &&
        (() => {
          const q = state.items[state.cursor];
          if (!q) return null;
          const total = state.items.length;
          const selected = state.selections[q.id] ?? [];
          const otherOn = selected.includes(OTHER);
          const isLast = state.cursor === total - 1;
          const answered = answerFor(q, state.selections, state.otherText).length > 0;
          const optList = [...q.options.filter(isRealOption), OTHER];

          // Left "draft" doc grows across rounds: answered facts from prior
          // rounds (always done) + this round's questions (active/done/pending).
          const priorFacts: Fact[] = answers.map((a) => ({
            key: a.questionId,
            label: factLabel(a.question),
            value: a.answer,
            status: "done",
          }));
          const roundFacts: Fact[] = state.items.map((qq, idx) => {
            const v = answerFor(qq, state.selections, state.otherText);
            const status: Fact["status"] =
              idx === state.cursor ? "active" : idx < state.cursor && v ? "done" : "pending";
            return { key: qq.id, label: factLabel(qq.text), value: v, status };
          });
          const facts = [...priorFacts, ...roundFacts];

          return (
            <div className="ed">
              <DraftStage
                facts={facts}
                docTitle={title.trim() || `${projectName} — PRD`}
                docMeta={projectName.toUpperCase()}
              />

              {/* RIGHT — worksheet */}
              <section className="ed-sheet">
                <div className="ed-sheet-head">
                  <button type="button" className="linkbtn" onClick={goToPrev}>
                    <span className="ci">
                      <ArrowLeft size={15} strokeWidth={2} />
                    </span>
                    {state.cursor === 0 && round === 0 ? "Setup" : "Back"}
                  </button>
                  <button type="button" className="linkbtn" onClick={() => router.push(backHref)}>
                    Save &amp; exit
                  </button>
                </div>

                <div className="ed-sheet-body">
                  <div key={state.cursor} className="ed-sheet-inner ed-anim">
                    <WzProgress
                      label={deepMode ? "Building the context" : "Sharpening the PRD"}
                      index={state.cursor}
                      total={total}
                    />
                    <h1 className="ed-q-text">
                      {q.text}
                      {q.multiSelect && <span className="ed-q-multi">— all that apply</span>}
                    </h1>
                    <div className="ed-opts">
                      {optList.map((opt) => {
                        const on = selected.includes(opt);
                        const isOther = opt === OTHER;
                        const isRecommended = matchesRecommended(opt, q.recommended);
                        return (
                          <label key={opt} className={`ed-opt ${on ? "on" : ""} ${q.multiSelect ? "sq" : ""}`}>
                            <input
                              className="ed-opt-input"
                              type={q.multiSelect ? "checkbox" : "radio"}
                              name={q.id}
                              checked={on}
                              onChange={() =>
                                isOther ? toggleOption(q.id, OTHER, q.multiSelect) : pickOption(opt)
                              }
                            />
                            <span className="ed-radio">
                              <Check size={12} strokeWidth={3} />
                            </span>
                            <span className="ed-opt-main">
                              <span className="ed-opt-line">
                                <span className="ed-opt-label">{isOther ? "Something else" : opt}</span>
                                {isRecommended && (
                                  <span className="rec-badge">
                                    <Ember size={11} />
                                    Krowe&apos;s pick
                                  </span>
                                )}
                              </span>
                              {isOther && <span className="ed-opt-sub">Write your own</span>}
                              {isRecommended && q.recommendation && (
                                <span className="ed-opt-why">
                                  <span className="qi">
                                    <Sparkles size={12} strokeWidth={2} />
                                  </span>
                                  {q.recommendation}
                                </span>
                              )}
                            </span>
                          </label>
                        );
                      })}
                      {otherOn && (
                        <textarea
                          className="ed-other-area"
                          autoFocus
                          value={state.otherText[q.id] ?? ""}
                          onChange={(e) =>
                            setState((prev) =>
                              prev.kind === "questions"
                                ? { ...prev, otherText: { ...prev.otherText, [q.id]: e.target.value } }
                                : prev
                            )
                          }
                          placeholder="Type the answer in your own words…"
                        />
                      )}
                    </div>
                  </div>
                </div>

                <div className="ed-sheet-foot">
                  <span className="foot-hint">
                    <span className="ed-kbd">1–{optList.length}</span>&nbsp;to pick
                  </span>
                  <button className="btn-primary" disabled={!answered} onClick={goToNext}>
                    {isLast ? "Generate my report" : "Next question"}
                    <ArrowRight size={16} strokeWidth={2} />
                  </button>
                </div>
              </section>
            </div>
          );
        })()}
    </div>
  );
}
