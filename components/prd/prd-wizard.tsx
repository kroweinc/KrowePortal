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
import type { DraftPrdResult } from "@/lib/prd/draft-core";
import { streamDraft } from "@/lib/ai/stream-client";
import { PrdDocument } from "@/components/prd/prd-document";
import {
  addSopTranscriptText,
  uploadSopTranscript,
  deleteSopTranscript,
} from "@/lib/actions/project-sop";
import { SOP_ACCEPT, MAX_SOP_CHARS } from "@/lib/attachments-constants";
import { SCOPE_STAGE_COUNT, SCOPE_OPENER, deepStageIndex, scopeStageAt } from "@/lib/prd/scope-stages";
import type { Question } from "@/lib/ai/schemas";
import type { ProjectSopTranscript, PrdContent } from "@/lib/types";

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

// Mask free typing into MM/DD/YYYY: digits only, slashes auto-inserted as the
// builder types so they never have to enter the separators themselves.
function maskDate(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  const segs = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean);
  return segs.join("/");
}

// Strict MM/DD/YYYY check: a real calendar date with a 4-digit year. Gates the
// Next button on a "date" question so partial/invalid dates can't be submitted.
function isValidDate(s: string): boolean {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  if (!m) return false;
  const mm = +m[1];
  const dd = +m[2];
  const yyyy = +m[3];
  const d = new Date(yyyy, mm - 1, dd);
  return d.getMonth() === mm - 1 && d.getDate() === dd && d.getFullYear() === yyyy;
}

// ── Date question: timeframe presets ──────────────────────────────────────
// A "date" question is rendered as a multiple-choice section: the builder
// first picks a rough window (weeks/months) which resolves to a concrete
// target date within it, OR picks EXACT to type a precise MM/DD/YYYY. Either
// way a real calendar date lands in otherText[q.id], which is what the rest of
// the flow (validation, the AI's back-planned timeline) consumes.
const EXACT = "__exact__";

type DatePreset = { id: string; label: string; days: number };

// `days` is a representative point inside each window (midpoint for ranges), so
// the resolved date always falls within the window the label promises.
const DATE_PRESETS: DatePreset[] = [
  { id: "wk2", label: "In about 2 weeks", days: 14 },
  { id: "mo2", label: "In 1–2 months", days: 45 },
  { id: "mo3", label: "In 2–3 months", days: 75 },
  { id: "mo6", label: "In 3–6 months", days: 135 },
];

function fmtUS(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

// Today + N days as MM/DD/YYYY. Called only from click/keyboard handlers and
// render of the questions phase (never during SSR — the wizard boots at the
// "intro" state), so a client-side `new Date()` is hydration-safe here.
function addDaysUS(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return fmtUS(d);
}

type AnswerEntry = { questionId: string; question: string; answer: string };

// A generated round retained so the builder can step back into it: the questions
// plus the live selections/free-text for each. Kept in the back/forward history.
type RoundData = {
  items: Question[];
  selections: Record<string, string[]>;
  otherText: Record<string, string>;
};

type WizardState =
  | { kind: "intro" }
  // `sections` accumulates the PRD content keys the model has streamed so far (the
  // final, streamed round only) — it drives WizLoading's real progress meter.
  // `partial` is the PRD-so-far (completed sections) for the live document preview.
  | { kind: "loading"; label: string; sections?: string[]; partial?: PrdContent }
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

// While the final PRD streams, show it building for real: each section pops into
// the stage the instant the model finishes writing it (fed by streamDraft's
// onContent). Replaces the answer-facts DraftStage during the final round so the
// ~30s wait is a document you watch assemble, not a bare progress bar. Reuses the
// read-only PrdDocument renderer (it guards every section, so a partial is safe)
// and the existing .ed-doc/.ed-fill styling — no new layout.
function LivePrdStage({ content, docTitle, docMeta }: { content: PrdContent; docTitle: string; docMeta: string }) {
  return (
    <section className="ed-stage">
      <div className="ed-stage-head">
        <span className="ed-stage-eyebrow">
          <Ember size={14} />
          Drafting live
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
            <PrdDocument content={content} />
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

// The PRD content keys the model streams (in document order), each mapped to the
// section name shown as it's written. createPrdSectionScanner emits these keys as
// they land, driving WizLoading's real progress meter. Trailing envelope keys that
// aren't sections (e.g. contextSummary) are intentionally absent.
const PRD_SECTION_LABELS: Record<string, string> = {
  overview: "Overview",
  goals: "Goals",
  successMetrics: "Success metrics",
  users: "Users & roles",
  coreUserFlow: "Core user flow",
  features: "Features",
  requirements: "Requirements",
  pagesScreens: "Pages & screens",
  successCriteria: "Success criteria",
  nonFunctionalRequirements: "Non-functional requirements",
  scopeLater: "Out of scope",
  futureExpansion: "Future expansion",
  dataModel: "Data model",
  integrations: "Integrations",
  techStack: "Tech stack",
  uxFlows: "UX flows",
  assumptions: "Assumptions",
  constraintsDetail: "Constraints",
  risks: "Risks",
  openQuestions: "Open questions",
  milestoneList: "Timeline & milestones",
  milestoneDueDate: "Deadline",
};
const PRD_SECTION_TOTAL = Object.keys(PRD_SECTION_LABELS).length;

// m:ss for a duration in ms.
function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// "Putting it together" panel with an estimated time-progress bar. Shown in the
// right sheet (or the first-load spinner spot) while a round generates. The fill
// eases toward a 92% cap so it never sits at 100% before the server responds; the
// parent redirects/unmounts the instant generation resolves, which reads as done.
function WizLoading({
  label,
  expectedMs,
  onCancel,
  sections,
}: {
  label: string;
  expectedMs: number;
  onCancel?: () => void;
  /** Content keys streamed so far (final PRD round). When present, the meter shows
      real progress off the model's actual output instead of a time estimate. */
  sections?: string[];
}) {
  const [elapsed, setElapsed] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    setReduceMotion(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
    const start = Date.now();
    const t = setInterval(() => setElapsed(Date.now() - start), 250);
    return () => clearInterval(t);
  }, []);

  // Real streamed progress: bar fills as the model writes each section, capped just
  // shy of 100% until the parent unmounts on `done` (same "snap to done" feel as the
  // eased estimate). Falls back to the time estimate for question rounds / blocking.
  const live = !!sections && sections.length > 0;
  const seen = live ? Math.min(sections!.length, PRD_SECTION_TOTAL) : 0;
  const currentLabel = live ? PRD_SECTION_LABELS[sections![sections!.length - 1]] ?? "Finishing up" : "";

  const ratio = elapsed / expectedMs;
  const estPct = Math.min(92, (1 - Math.exp(-1.6 * ratio)) * 92);
  const pct = live ? Math.min(96, (seen / PRD_SECTION_TOTAL) * 100) : estPct;
  const over = elapsed >= expectedMs;

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
        {live ? (
          <span>
            Writing {currentLabel} · {String(seen).padStart(2, "0")}/{String(PRD_SECTION_TOTAL).padStart(2, "0")}
          </span>
        ) : (
          <span>{over ? "Taking a little longer than usual…" : `~${fmtClock(expectedMs - elapsed)} left`}</span>
        )}
      </div>

      {onCancel && (
        <button type="button" className="prd-progress-cancel" onClick={onCancel}>
          Cancel · Esc
        </button>
      )}
    </div>
  );
}

interface Props {
  projectId: string;
  projectName: string;
  backHref: string;
  initialTitle: string;
  initialSopTranscripts: ProjectSopTranscript[];
  /** When true, the final generation streams progressively via the SSE route
      (OPENAI_ENABLE_STREAMING). Off ⇒ the blocking draftPrd action path. */
  streamingEnabled?: boolean;
}

export function PrdWizard({
  projectId,
  projectName,
  backHref,
  initialTitle,
  initialSopTranscripts,
  streamingEnabled = false,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [title, setTitle] = useState(initialTitle);
  const [notes, setNotes] = useState("");
  // Completed earlier rounds (back) and rounds we've stepped back out of but can
  // step forward into again without regenerating (forward). The current round
  // lives in `state` while answering; on submit it moves into `back`. The round
  // index the builder is on is simply how many rounds sit behind them.
  const [back, setBack] = useState<RoundData[]>([]);
  const [forward, setForward] = useState<RoundData[]>([]);
  const round = back.length;
  const [state, setState] = useState<WizardState>({ kind: "intro" });
  // Always points at the latest state so queued auto-advance timers and the
  // global keydown handler read fresh selections/cursor, never a stale closure.
  const stateRef = useRef(state);
  stateRef.current = state;
  // Mirror the history into refs so the keydown handler and queued callbacks read
  // fresh back/forward, never a stale closure (same pattern as stateRef).
  const backRef = useRef<RoundData[]>([]);
  backRef.current = back;
  const forwardRef = useRef<RoundData[]>([]);
  forwardRef.current = forward;
  // Generation token: bumping it abandons the in-flight draft so a cancelled
  // round can't navigate away or overwrite the screen when it finally resolves.
  const genId = useRef(0);
  // Aborts the in-flight streaming fetch on cancel — stops server work too.
  const abortRef = useRef<AbortController | null>(null);
  // Snapshot of the screen + round history to restore if a round is cancelled or fails.
  const restoreRef = useRef<{ state: WizardState; back: RoundData[]; forward: RoundData[] } | null>(null);
  // Cosmetic only — the server decides behavior from the (empty) notes each round.
  const [deepMode, setDeepMode] = useState(false);

  // ⌘ on Mac, Ctrl elsewhere — the label for the "advance" shortcut shown on
  // free-text questions. Read lazily; the questions phase is client-only, so it
  // never lands in SSR markup and can't mismatch on hydration.
  const [kbdLabel] = useState(() =>
    typeof navigator !== "undefined" && !/mac/i.test(navigator.platform) ? "Ctrl ↵" : "⌘↵"
  );

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
    const myGen = ++genId.current;
    setState({ kind: "loading", label });

    const payload = {
      projectId,
      title: title.trim() || `${projectName} — PRD`,
      notes: notes.trim() || undefined,
      answers: nextAnswers,
      round: nextRound,
    };

    // One result handler for both the streaming and blocking paths.
    const handle = (result: DraftPrdResult) => {
      if (myGen !== genId.current) return; // cancelled — abandon the result

      if ("error" in result) {
        toast.error(result.error);
        // Roll back to the screen the round was launched from, answers intact.
        restoreScreen();
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
    };

    if (streamingEnabled) {
      // Stream the generation for true server-side cancellation via
      // AbortController. Falls back to an error toast on failure.
      const controller = new AbortController();
      abortRef.current = controller;
      void (async () => {
        try {
          const evt = await streamDraft("/api/ai/prd/stream", payload, {
            signal: controller.signal,
            // Each section the model streams advances the real progress meter. Guard
            // on the gen token so a cancelled round's late deltas can't update state.
            onSection: (key) => {
              if (myGen !== genId.current) return;
              setState((s) => (s.kind === "loading" ? { ...s, sections: [...(s.sections ?? []), key] } : s));
            },
            // The PRD-so-far, for the live document preview. Same gen-token guard.
            onContent: (partial) => {
              if (myGen !== genId.current) return;
              setState((s) => (s.kind === "loading" ? { ...s, partial } : s));
            },
          });
          if (myGen !== genId.current) return;
          if (evt.type === "questions") handle({ kind: "questions", items: evt.items });
          else if (evt.type === "done" && evt.prdId) handle({ kind: "prd", prdId: evt.prdId });
          else handle({ error: evt.type === "error" ? evt.error : "Generation failed." });
        } catch (err) {
          if (myGen !== genId.current) return; // aborted by cancelLoading — ignore
          handle({ error: err instanceof Error ? err.message : "Generation failed." });
        }
      })();
      return;
    }

    startTransition(async () => {
      handle(await draftPrd(payload));
    });
  }

  // Restore the pre-generation screen + round history from the snapshot.
  function restoreScreen() {
    const r = restoreRef.current;
    if (r) {
      setBack(r.back);
      setForward(r.forward);
      setState(r.state);
    } else {
      setState({ kind: "intro" });
    }
  }

  // Cancel an in-progress generation: abandon the draft and return to the
  // screen the round was launched from, with the latest round rolled back out.
  function cancelLoading() {
    if (stateRef.current.kind !== "loading") return;
    genId.current += 1;
    // Abort the streaming fetch so the server stops generating (and skips the save).
    abortRef.current?.abort();
    abortRef.current = null;
    restoreScreen();
  }

  // Esc cancels an in-progress generation, mirroring the on-screen Cancel button.
  useEffect(() => {
    if (state.kind !== "loading") return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelLoading();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.kind]);

  function start() {
    // No title needed to begin — an empty title falls back to the project name in
    // run(), so a no-notes builder can start straight from "what's your idea?".
    setDeepMode(!notes.trim());
    setBack([]);
    setForward([]);
    // Cancelling or failing the first round returns to this setup screen.
    restoreRef.current = { state: { kind: "intro" }, back: [], forward: [] };
    run([], 0, notes.trim() ? "Reading your notes…" : "Preparing questions…");
  }

  function answerFor(q: Question, selections: Record<string, string[]>, otherText: Record<string, string>): string {
    // Date and free-text questions store the typed value in otherText (no options).
    if (q.inputType === "date" || q.inputType === "text") return (otherText[q.id] ?? "").trim();
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

  // Whether the question has a usable answer. A date question requires a complete,
  // valid MM/DD/YYYY; a free-text or choice question just needs a non-empty answer.
  function isAnswered(q: Question, selections: Record<string, string[]>, otherText: Record<string, string>): boolean {
    if (q.inputType === "date") return isValidDate(otherText[q.id] ?? "");
    return answerFor(q, selections, otherText).length > 0;
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

  // The flat answer list for a set of rounds, in order — what the server sees.
  // Skipped/blank answers (e.g. an optional gap-filler the builder skipped) are
  // dropped so they neither reach the model as empty Q/A nor show as "facts".
  function roundToAnswers(rounds: RoundData[]): AnswerEntry[] {
    return rounds.flatMap((r) =>
      r.items
        .map((q) => ({
          questionId: q.id,
          question: q.text,
          answer: answerFor(q, r.selections, r.otherText),
        }))
        .filter((a) => a.answer.length > 0)
    );
  }

  function submitAnswers() {
    const s = stateRef.current;
    if (s.kind !== "questions") return;
    const current: RoundData = { items: s.items, selections: s.selections, otherText: s.otherText };

    // Not at the frontier: the next round was already generated and we stepped
    // back out of it. Move forward into it again instead of regenerating.
    if (forwardRef.current.length > 0) {
      const [next, ...rest] = forwardRef.current;
      setBack((b) => [...b, current]);
      setForward(rest);
      setState({
        kind: "questions",
        items: next.items,
        selections: next.selections,
        otherText: next.otherText,
        cursor: 0,
      });
      return;
    }

    // Frontier: bank this round and generate the next round (or the final PRD).
    const nextBack = [...backRef.current, current];
    restoreRef.current = { state: s, back: backRef.current, forward: forwardRef.current };
    setBack(nextBack);
    setForward([]);
    run(roundToAnswers(nextBack), nextBack.length, "Putting your PRD together…");
  }

  // Advance to the next question, or submit the whole round on the last one.
  // Reads the latest state via stateRef so the handler never acts on stale
  // selections.
  function goToNext() {
    const s = stateRef.current;
    if (s.kind !== "questions") return;
    if (s.cursor < s.items.length - 1) {
      setState((prev) => (prev.kind === "questions" ? { ...prev, cursor: prev.cursor + 1 } : prev));
    } else {
      submitAnswers();
    }
  }

  // Back one question. At the first question of a round, step into the previous
  // round (landing on its last question) so earlier answers can be reviewed and
  // changed; at the very first question of the first round, return to setup.
  function goToPrev() {
    const s = stateRef.current;
    if (s.kind !== "questions") return;
    if (s.cursor > 0) {
      setState((prev) => (prev.kind === "questions" ? { ...prev, cursor: prev.cursor - 1 } : prev));
      return;
    }
    if (backRef.current.length > 0) {
      const prev = backRef.current[backRef.current.length - 1];
      const current: RoundData = { items: s.items, selections: s.selections, otherText: s.otherText };
      setBack((b) => b.slice(0, -1));
      setForward((f) => [current, ...f]);
      setState({
        kind: "questions",
        items: prev.items,
        selections: prev.selections,
        otherText: prev.otherText,
        cursor: prev.items.length - 1,
      });
      return;
    }
    setState({ kind: "intro" });
  }

  // Pick an option. First click on a single-select option just selects it;
  // clicking the option that's already selected confirms and advances. Multi-
  // select always toggles and waits for an explicit Next.
  function pickOption(opt: string) {
    const s = stateRef.current;
    if (s.kind !== "questions") return;
    const q = s.items[s.cursor];
    if (!q) return;
    if (q.multiSelect) {
      toggleOption(q.id, opt, q.multiSelect);
      return;
    }
    // Single-select: a second click on the current choice moves on.
    if ((s.selections[q.id] ?? []).includes(opt)) {
      goToNext();
      return;
    }
    toggleOption(q.id, opt, q.multiSelect);
  }

  // Date question — pick a timeframe window. The window resolves to a concrete
  // calendar date (stored in otherText so it flows downstream); selections only
  // tracks which option is highlighted.
  function pickDatePreset(qId: string, presetId: string, resolved: string) {
    setState((prev) =>
      prev.kind === "questions"
        ? {
            ...prev,
            selections: { ...prev.selections, [qId]: [presetId] },
            otherText: { ...prev.otherText, [qId]: resolved },
          }
        : prev
    );
  }

  // Date question — switch to the exact-date input. Clears any preset-resolved
  // date so the builder types into an empty field (and the Next button re-locks
  // until a full, valid MM/DD/YYYY is entered).
  function selectExactDate(qId: string) {
    setState((prev) =>
      prev.kind === "questions"
        ? {
            ...prev,
            selections: { ...prev.selections, [qId]: [EXACT] },
            otherText: { ...prev.otherText, [qId]: "" },
          }
        : prev
    );
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
      // Date questions are a multiple-choice section: timeframe presets plus a
      // trailing "exact date" option. 1–N picks one (the last index reveals the
      // exact input); Enter advances once a date has resolved; ← goes back.
      if (q.inputType === "date") {
        const total = DATE_PRESETS.length + 1; // presets + exact
        const n = parseInt(e.key, 10);
        if (!Number.isNaN(n) && n >= 1 && n <= total) {
          e.preventDefault();
          if (n === total) selectExactDate(q.id);
          else {
            const p = DATE_PRESETS[n - 1];
            pickDatePreset(q.id, p.id, addDaysUS(p.days));
          }
        } else if (e.key === "Enter" && isAnswered(q, s.selections, s.otherText)) {
          e.preventDefault();
          goToNext();
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          goToPrev();
        }
        return;
      }
      // Free-text questions leave Enter to the textarea (newlines) and advance
      // via the Next button. ← goes back. Typing is handled by the field itself,
      // since the guard above already ignores text inputs.
      if (q.inputType === "text") {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          goToPrev();
        }
        return;
      }
      const opts = [...q.options.filter(isRealOption), OTHER];
      const n = parseInt(e.key, 10);
      if (!Number.isNaN(n) && n >= 1 && n <= opts.length) {
        e.preventDefault();
        const opt = opts[n - 1];
        if (opt === OTHER) toggleOption(q.id, OTHER, q.multiSelect);
        else pickOption(opt);
      } else if (e.key === "Enter") {
        if (isAnswered(q, s.selections, s.otherText)) {
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
        (() => {
          const docTitle = title.trim() || `${projectName} — PRD`;
          const docMeta = projectName.toUpperCase();
          // Once the final PRD starts streaming its sections, show it building live.
          const livePartial = state.partial && Object.keys(state.partial).length > 0 ? state.partial : null;

          if (livePartial) {
            // The document assembles on the left; the meter + Cancel ride along right.
            return (
              <div className="ed">
                <LivePrdStage content={livePartial} docTitle={docTitle} docMeta={docMeta} />
                <section className="ed-sheet">
                  <div className="ed-sheet-body">
                    <div className="ed-sheet-inner">
                      <WizLoading label={state.label} expectedMs={EXPECTED_GENERATE_MS} onCancel={cancelLoading} sections={state.sections} />
                    </div>
                  </div>
                </section>
              </div>
            );
          }

          return back.length > 0 ? (
            // Mid-interview: keep the editorial overlay up with the draft visible
            // on the left while the next round (or the final PRD) generates.
            <div className="ed">
              <DraftStage
                facts={roundToAnswers(back).map((a) => ({
                  key: a.questionId,
                  label: factLabel(a.question),
                  value: a.answer,
                  status: "done" as const,
                }))}
                docTitle={docTitle}
                docMeta={docMeta}
              />
              <section className="ed-sheet">
                <div className="ed-sheet-body">
                  <div className="ed-sheet-inner">
                    <WizLoading label={state.label} expectedMs={EXPECTED_GENERATE_MS} onCancel={cancelLoading} sections={state.sections} />
                  </div>
                </div>
              </section>
            </div>
          ) : (
            // First load (no answers yet): in-page progress meter.
            <div className="prd-loading">
              <WizLoading label={state.label} expectedMs={EXPECTED_FIRST_MS} onCancel={cancelLoading} sections={state.sections} />
            </div>
          );
        })()}

      {state.kind === "questions" &&
        (() => {
          const q = state.items[state.cursor];
          if (!q) return null;
          const total = state.items.length;
          const selected = state.selections[q.id] ?? [];
          const otherOn = selected.includes(OTHER);
          const isLast = state.cursor === total - 1;
          // Only the last question of the newest round actually generates; a last
          // question with a round still ahead just steps forward into it.
          const isFinalSubmit = isLast && forward.length === 0;
          const answered = isAnswered(q, state.selections, state.otherText);
          // ⌘/Ctrl+Enter advances from inside a free-text answer — the question's
          // own textarea or the "Something else" box — where plain Enter has to
          // stay a newline. The global keydown handler bails on textareas, so this
          // is what makes the shortcut reach them. Reads the freshest text off
          // stateRef, the same way goToNext does.
          const onAnswerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              const s = stateRef.current;
              if (s.kind === "questions" && isAnswered(q, s.selections, s.otherText)) goToNext();
            }
          };
          // Optional questions (e.g. the catch-all gap-filler) can be skipped: the
          // Skip control shows until the builder starts typing an answer.
          const canSkip = !!q.skippable && !answered;
          const isDate = q.inputType === "date";
          const isText = q.inputType === "text";
          const optList = [...q.options.filter(isRealOption), OTHER];
          // No-notes flow runs the fixed scope backbone. Round 0 is the unnumbered
          // free-text opener ("Your idea"); rounds 1..N are the numbered stages
          // ("Step 2 of 4 · Users & roles") via deepStageIndex(round).
          const stageIdx = deepMode ? deepStageIndex(round) : null;
          const progressLabel = !deepMode
            ? "Sharpening the PRD"
            : stageIdx === null
              ? SCOPE_OPENER.label
              : `Step ${stageIdx + 1} of ${SCOPE_STAGE_COUNT} · ${scopeStageAt(stageIdx).label}`;

          // Left "draft" doc grows across rounds: answered facts from prior
          // rounds (always done) + this round's questions (active/done/pending).
          const priorFacts: Fact[] = roundToAnswers(back).map((a) => ({
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
                    {state.cursor === 0 && back.length === 0 ? "Setup" : "Back"}
                  </button>
                  <button type="button" className="linkbtn" onClick={() => router.push(backHref)}>
                    Cancel
                  </button>
                </div>

                <div className="ed-sheet-body">
                  <div key={state.cursor} className="ed-sheet-inner ed-anim">
                    <WzProgress label={progressLabel} index={state.cursor} total={total} />
                    <h1 className="ed-q-text">
                      {q.text}
                    </h1>
                    <div className="ed-opts">
                      {isDate ? (
                        <>
                          {/* Timeframe windows — each resolves to a concrete date. */}
                          {DATE_PRESETS.map((p) => {
                            const resolved = addDaysUS(p.days);
                            const on = selected.includes(p.id);
                            return (
                              <label key={p.id} className={`ed-opt ${on ? "on" : ""}`}>
                                <input
                                  className="ed-opt-input"
                                  type="radio"
                                  name={q.id}
                                  checked={on}
                                  readOnly
                                  onClick={() => pickDatePreset(q.id, p.id, resolved)}
                                />
                                <span className="ed-radio">
                                  <Check size={12} strokeWidth={3} />
                                </span>
                                <span className="ed-opt-main">
                                  <span className="ed-opt-line">
                                    <span className="ed-opt-label">{p.label}</span>
                                  </span>
                                  <span className="ed-opt-sub">Targets {resolved}</span>
                                </span>
                              </label>
                            );
                          })}
                          {/* Escape hatch — reveals the precise MM/DD/YYYY input. */}
                          <label className={`ed-opt ${selected.includes(EXACT) ? "on" : ""}`}>
                            <input
                              className="ed-opt-input"
                              type="radio"
                              name={q.id}
                              checked={selected.includes(EXACT)}
                              readOnly
                              onClick={() => selectExactDate(q.id)}
                            />
                            <span className="ed-radio">
                              <Check size={12} strokeWidth={3} />
                            </span>
                            <span className="ed-opt-main">
                              <span className="ed-opt-line">
                                <span className="ed-opt-label">I have an exact date</span>
                              </span>
                              <span className="ed-opt-sub">Type the precise go-live date</span>
                            </span>
                          </label>
                          {selected.includes(EXACT) && (
                            <div className="ed-date">
                              <input
                                className="ed-date-input"
                                type="text"
                                inputMode="numeric"
                                autoFocus
                                maxLength={10}
                                placeholder="MM/DD/YYYY"
                                value={state.otherText[q.id] ?? ""}
                                onChange={(e) =>
                                  setState((prev) =>
                                    prev.kind === "questions"
                                      ? {
                                          ...prev,
                                          otherText: { ...prev.otherText, [q.id]: maskDate(e.target.value) },
                                        }
                                      : prev
                                  )
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && answered) {
                                    e.preventDefault();
                                    goToNext();
                                  }
                                }}
                              />
                              <span className="ed-date-hint">
                                Type the exact date — e.g. 09/15/2026
                              </span>
                            </div>
                          )}
                        </>
                      ) : isText ? (
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
                          onKeyDown={onAnswerKeyDown}
                          placeholder="Describe it in your own words — a sentence or two is plenty…"
                        />
                      ) : (
                        <>
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
                              readOnly
                              // onClick (not onChange): re-clicking the already-selected
                              // radio fires no change event, but that second click is
                              // exactly what should confirm the choice and advance.
                              onClick={() =>
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
                          onKeyDown={onAnswerKeyDown}
                          placeholder="Type the answer in your own words…"
                        />
                      )}
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="ed-sheet-foot">
                  <div className="ed-foot-left">
                    <span className="foot-hint">
                      {isDate ? (
                        <>
                          <span className="ed-kbd">1–{DATE_PRESETS.length + 1}</span>&nbsp;to pick
                        </>
                      ) : isText ? (
                        <>
                          type your answer, then&nbsp;<span className="ed-kbd">{kbdLabel}</span>
                        </>
                      ) : (
                        <>
                          <span className="ed-kbd">1–{optList.length}</span>&nbsp;to pick
                          {otherOn && (
                            <>
                              &nbsp;·&nbsp;<span className="ed-kbd">{kbdLabel}</span>&nbsp;to submit
                            </>
                          )}
                        </>
                      )}
                    </span>
                    {canSkip && (
                      <button type="button" className="linkbtn" onClick={goToNext}>
                        Skip
                      </button>
                    )}
                  </div>
                  <button className="btn-primary" disabled={!answered} onClick={goToNext}>
                    {isFinalSubmit ? "Generate my report" : "Next question"}
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
