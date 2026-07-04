"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  Plus,
  X,
  Paperclip,
  Maximize2,
  Minimize2,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Building2,
  RefreshCw,
  WandSparkles,
  Check,
  Sparkles,
  Bug,
  GitPullRequestArrow,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { createTask } from "@/lib/actions/tasks";
import { uploadAttachment } from "@/lib/actions/attachments";
import { generateTaskDraft } from "@/lib/actions/ai-tasks";
import type { TaskDraft } from "@/lib/ai/schemas";
import type { TaskPriority, TaskType } from "@/lib/types";
import { OPEN_NEW_TASK_EVENT } from "@/components/add-task-button";

const MAX_SIZE = 25 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg",
  ".pdf",
  ".txt", ".csv", ".md", ".json",
  ".html", ".htm",
  ".zip",
  ".docx", ".xlsx", ".pptx", ".doc", ".xls",
]);

const ACCEPT = [
  "image/jpeg,image/png,image/gif,image/webp,image/svg+xml",
  "application/pdf",
  "text/plain,text/csv,text/html",
  "application/json",
  "application/zip",
  ".md,.html,.htm,.docx,.xlsx,.pptx,.doc,.xls",
].join(",");

function getExt(fileName: string) {
  return "." + (fileName.split(".").pop()?.toLowerCase() ?? "bin");
}

interface NewTaskFormProps {
  engagementId?: string;
  engagements?: { id: string; title: string }[];
  placeholder?: string;
  onSuccess?: () => void;
  /** Product-tour anchor key, emitted as data-tour on the launcher. */
  tourId?: string;
}

const PERSONAL = "__personal__";
const OTHER = "__other__";
// Server-enforced cap on clarification rounds; hide the affordance at the limit.
const MAX_CLARIFICATIONS = 5;

const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

// Same Linear-style icon set as TaskTypeBadge on the board cards.
const TYPES: { value: TaskType; label: string; icon: LucideIcon }[] = [
  { value: "feature", label: "Feature", icon: Sparkles },
  { value: "bug", label: "Bug", icon: Bug },
  { value: "change", label: "Change", icon: GitPullRequestArrow },
];

type AiMode =
  | { kind: "idle" }
  | { kind: "input"; prompt: string }
  | { kind: "loading" };

type View = "ai" | "loading" | "questions" | "review" | "manual";

/** Signature ember glyph — the AI accent mark from the design system. */
function Ember({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill="var(--primary)" opacity="0.2" />
      <circle cx="8" cy="8" r="4" fill="var(--primary)" opacity="0.42" />
      <circle cx="8" cy="8" r="2.5" fill="var(--primary)" />
      <circle cx="9" cy="7" r="1" fill="var(--primary-accent)" />
    </svg>
  );
}

function PrimaryBtn({
  icon,
  kbd,
  full,
  children,
  ...rest
}: {
  icon: React.ReactNode;
  kbd?: string;
  full?: boolean;
  children: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`krowe-nt-primary${full ? " is-full" : ""}`} {...rest}>
      <span className="krowe-nt-sheen" aria-hidden="true" />
      {icon}
      <span className="krowe-nt-primary-label">{children}</span>
      {kbd && <span className="krowe-nt-kbd">{kbd}</span>}
    </button>
  );
}

export function NewTaskForm({ engagementId, engagements = [], placeholder, onSuccess, tourId }: NewTaskFormProps) {
  const [expanded, setExpanded] = useState(false);
  const [modal, setModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // undefined = follow the engagementId prop (the board's active filter / first engagement)
  const [engagementChoice, setEngagementChoice] = useState<string | undefined>(undefined);
  const selectedEngagement = engagementChoice ?? engagementId ?? PERSONAL;
  const effectiveEngagementId = selectedEngagement === PERSONAL ? undefined : selectedEngagement;

  // Form fields (controlled so the AI flow can prefill them)
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");

  // The Linear-style classification an AI draft carries. Set from the draft and
  // submitted with the task so it persists inline at creation — no deferred
  // classifier pass and no "type/tag fills in late" delay. Null on manual entry,
  // where the server falls back to classifying after creation.
  const [aiType, setAiType] = useState<TaskType | null>(null);
  const [aiTags, setAiTags] = useState<string[]>([]);

  // True once an AI draft has prefilled the form, to drive the "Review AI draft"
  // affordance. The AI never generates subtasks — they're added manually from the
  // task's sidebar checklist.
  const [aiDrafted, setAiDrafted] = useState(false);

  // Assumptions the AI made where the prompt was ambiguous, shown read-only on
  // the draft so a wrong call can be caught before creating. Never submitted.
  const [aiAssumptions, setAiAssumptions] = useState<string[]>([]);
  const [showAllAssumptions, setShowAllAssumptions] = useState(false);

  // Follow-up question from the latest draft when the AI judged the request
  // weak; null when it was strong. Drives the "Strengthen this task" affordance
  // in the assumptions box. UI-only, never submitted.
  const [aiFollowUp, setAiFollowUp] = useState<TaskDraft["followUp"] | null>(null);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  // Selected answer chip — an option's text, or OTHER for the free-text escape.
  const [followUpChoice, setFollowUpChoice] = useState<string | null>(null);
  const [followUpOther, setFollowUpOther] = useState("");
  // The raw description actually sent for the current draft, so strengthening
  // regenerates from the ORIGINAL request rather than the edited form fields.
  const [lastPrompt, setLastPrompt] = useState("");
  // Q&A accumulated across strengthen rounds. Carried into BOTH strengthen and
  // plain Regenerate calls so a redraft never gets weaker; reset on close.
  const [clarifications, setClarifications] = useState<{ question: string; answer: string }[]>([]);

  // Default to the AI input the moment the "+" opens the form — the AI flow is
  // the primary path, with "Manual entry" available as an escape hatch. resetForm
  // returns here too, so every fresh open lands in AI mode.
  const [aiMode, setAiMode] = useState<AiMode>({ kind: "input", prompt: "" });

  // ⌘ on Mac, Ctrl elsewhere. Safe to read lazily: the chip only renders once
  // the panel is opened client-side, so it never appears in SSR markup.
  const [kbdLabel] = useState(() =>
    typeof navigator !== "undefined" && !/mac/i.test(navigator.platform) ? "Ctrl ↵" : "⌘↵"
  );

  useEffect(() => {
    const open = () => setExpanded(true);
    window.addEventListener(OPEN_NEW_TASK_EVENT, open);
    return () => window.removeEventListener(OPEN_NEW_TASK_EVENT, open);
  }, []);

  function resetForm() {
    setTitle("");
    setDescription("");
    setPriority("medium");
    setAiType(null);
    setAiTags([]);
    setAiDrafted(false);
    setAiAssumptions([]);
    setShowAllAssumptions(false);
    setAiFollowUp(null);
    setFollowUpOpen(false);
    setFollowUpChoice(null);
    setFollowUpOther("");
    setLastPrompt("");
    setClarifications([]);
    setAiMode({ kind: "input", prompt: "" });
    setFiles([]);
    setError(null);
    setEngagementChoice(undefined);
  }

  function handleClose() {
    setExpanded(false);
    setModal(false);
    resetForm();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    e.target.value = "";
    const valid = selected.filter((f) => {
      if (f.size > MAX_SIZE) return false;
      if (!ALLOWED_EXTENSIONS.has(getExt(f.name))) return false;
      return true;
    });
    setFiles((prev) => [...prev, ...valid]);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function applyDraft(draft: TaskDraft) {
    setTitle(draft.title);
    setDescription(draft.description);
    setPriority(draft.priority);
    setAiType(draft.type);
    setAiTags(draft.tags);
    setAiAssumptions(draft.assumptions);
    setShowAllAssumptions(false);
    setAiFollowUp(draft.followUp ?? null);
    setFollowUpOpen(false);
    setFollowUpChoice(null);
    setFollowUpOther("");
    setAiDrafted(true);
  }

  function generate(opts?: { raw: string; clarifications: { question: string; answer: string }[] }) {
    // Without opts (Generate / Regenerate), draft from what's in the form and
    // carry any accumulated clarifications so a redraft never gets weaker. The
    // strengthen flow passes opts to regenerate from the original request + Q&A.
    const raw =
      opts?.raw ??
      (aiMode.kind === "input"
        ? aiMode.prompt.trim()
        : [title.trim(), description.trim()].filter(Boolean).join("\n\n"));
    const clar = opts?.clarifications ?? clarifications;
    if (raw.length < 5) {
      toast.error("Type a few words describing what you want first.");
      return;
    }

    setLastPrompt(raw);
    setClarifications(clar);
    setAiMode({ kind: "loading" });
    startTransition(async () => {
      const result = await generateTaskDraft({
        rawDescription: raw,
        engagementId: effectiveEngagementId,
        clarifications: clar.length > 0 ? clar : undefined,
      });

      if ("error" in result) {
        toast.error(result.error);
        setAiMode({ kind: "idle" });
        return;
      }

      applyDraft(result.item);
      setAiMode({ kind: "idle" });
    });
  }

  function openFollowUp() {
    if (!aiFollowUp) return;
    // Pre-select the AI's recommended option (tolerating a recommended value
    // that matches no option — then nothing is pre-selected).
    setFollowUpChoice(
      aiFollowUp.recommended && aiFollowUp.options.includes(aiFollowUp.recommended)
        ? aiFollowUp.recommended
        : null
    );
    setFollowUpOther("");
    setFollowUpOpen(true);
  }

  function submitFollowUp() {
    if (!aiFollowUp) return;
    const answer = followUpChoice === OTHER ? followUpOther.trim() : followUpChoice;
    if (!answer || answer.length < 2) return;
    generate({
      raw: lastPrompt,
      clarifications: [...clarifications, { question: aiFollowUp.question, answer }],
    });
  }

  async function uploadAllAttachments(taskId: string) {
    if (files.length === 0) return;
    await Promise.all(
      files.map((file) => {
        const fd = new FormData();
        fd.set("task_id", taskId);
        fd.set("file", file);
        return uploadAttachment(fd);
      })
    );
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("Title is required.");
      return;
    }

    startTransition(async () => {
      const fd = new FormData();
      if (effectiveEngagementId) fd.set("engagement_id", effectiveEngagementId);
      fd.set("title", title.trim());
      if (description.trim()) fd.set("description", description.trim());
      fd.set("priority", priority);
      // Carry the AI draft's classification so it persists on insert. Absent on
      // manual entry, where createTask classifies after creation instead.
      if (aiType) {
        fd.set("type", aiType);
        fd.set("tags", JSON.stringify(aiTags));
      }

      const result = await createTask(fd);
      if (result?.error) {
        setError(result.error);
        return;
      }

      if (result?.taskId) {
        await uploadAllAttachments(result.taskId);
      }

      handleClose();
      onSuccess?.();
    });
  }

  const isBusy = isPending || aiMode.kind === "loading";
  const canGenerate =
    aiMode.kind === "input"
      ? aiMode.prompt.trim().length >= 5
      : (title.trim() + description.trim()).length >= 5;
  const canStrengthen = Boolean(aiFollowUp) && clarifications.length < MAX_CLARIFICATIONS;

  const view: View =
    aiMode.kind === "loading" ? "loading"
    : aiMode.kind === "input" ? "ai"
    : followUpOpen && aiFollowUp ? "questions"
    : aiDrafted ? "review"
    : "manual";

  function toggleAi() {
    if (aiMode.kind === "input") {
      // AI → Manual: don't lose what was typed in the prompt
      const prompt = aiMode.prompt.trim();
      if (prompt) {
        setDescription((prev) => (prev ? prev : prompt));
      }
      setAiMode({ kind: "idle" });
    } else if (aiMode.kind === "idle") {
      // Manual → AI: seed the prompt from whatever is already in the form
      const seed = [title.trim(), description.trim()].filter(Boolean).join("\n\n");
      setAiMode({ kind: "input", prompt: seed });
    }
  }

  // Esc closes (steps back to review from questions); ⌘/Ctrl+Enter fires the
  // view's primary action. No dependency array — the handler needs each
  // render's latest state and re-attaching a listener is cheap.
  useEffect(() => {
    if (!expanded) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (e.defaultPrevented) return;
        if (followUpOpen) setFollowUpOpen(false);
        else handleClose();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (isBusy) return;
        if (view === "ai") {
          if (canGenerate) generate();
        } else if (view === "review" || view === "manual") {
          formRef.current?.requestSubmit();
        } else if (view === "questions") {
          submitFollowUp();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // On the draft views the header IS the title — an editable input in the
  // title's serif style, replacing the static "Review AI draft" label. It lives
  // outside the <form>, which is fine: submit reads the controlled state.
  const header = (
    <div className="krowe-nt-head">
      <div className="krowe-nt-head-l">
        {view === "review" || view === "questions" ? (
          <input
            className="krowe-nt-title krowe-nt-titleinput"
            aria-label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task title"
          />
        ) : (
          <>
            <Ember size={15} />
            <span className="krowe-nt-title">New task</span>
          </>
        )}
      </div>
      <div className="krowe-nt-head-r">
        <button
          type="button"
          className="krowe-nt-iconbtn"
          onClick={() => setModal((v) => !v)}
          aria-label={modal ? "Dock to side" : "Expand"}
        >
          {modal ? <Minimize2 width={15} height={15} /> : <Maximize2 width={15} height={15} />}
        </button>
        <button type="button" className="krowe-nt-iconbtn" onClick={handleClose} aria-label="Close">
          <X width={15} height={15} />
        </button>
      </div>
    </div>
  );

  const assumedCard = (opts: { strengthen: boolean }) =>
    (aiAssumptions.length > 0 || (opts.strengthen && canStrengthen)) && (
      <div className="krowe-nt-assumed">
        <div className="krowe-nt-assumed-head">
          <Ember size={12} /> What krowe assumed
        </div>
        <ul className="krowe-nt-assumed-list">
          {(showAllAssumptions ? aiAssumptions : aiAssumptions.slice(0, 2)).map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
        {(aiAssumptions.length > 2 || (opts.strengthen && canStrengthen)) && (
          <div className="krowe-nt-assumed-actions">
            {aiAssumptions.length > 2 && (
              <button
                type="button"
                className="krowe-nt-more"
                onClick={() => setShowAllAssumptions((v) => !v)}
              >
                {showAllAssumptions ? "Show less" : `Show ${aiAssumptions.length - 2} more`}
                {showAllAssumptions ? (
                  <ChevronUp width={13} height={13} />
                ) : (
                  <ChevronDown width={13} height={13} />
                )}
              </button>
            )}
            {opts.strengthen && canStrengthen && (
              <button
                type="button"
                className="krowe-nt-strengthen"
                onClick={openFollowUp}
                disabled={isBusy}
              >
                <WandSparkles width={13} height={13} /> Strengthen this task
              </button>
            )}
          </div>
        )}
      </div>
    );

  const fileList = files.length > 0 && (
    <ul className="krowe-nt-files" style={{ margin: 0, padding: 0, listStyle: "none" }}>
      {files.map((f, i) => (
        <li key={i} className="krowe-nt-file">
          <span className="krowe-nt-file-name">{f.name}</span>
          <button
            type="button"
            className="krowe-nt-file-rm"
            onClick={() => removeFile(i)}
            aria-label={`Remove ${f.name}`}
          >
            <X width={13} height={13} />
          </button>
        </li>
      ))}
    </ul>
  );

  const attachments = (
    <>
      <div className="krowe-nt-attach">
        <span className="krowe-nt-flabel">Attachments</span>
        <button
          type="button"
          className="krowe-nt-textbtn"
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip width={13} height={13} /> Add file
        </button>
      </div>
      {fileList}
    </>
  );

  const clientOptions = (
    <>
      {engagements.map((eng) => (
        <option key={eng.id} value={eng.id}>
          {eng.title}
        </option>
      ))}
      <option value={PERSONAL}>Personal (no client)</option>
    </>
  );

  const priorityOptions = PRIORITIES.map((p) => (
    <option key={p.value} value={p.value}>
      {p.label}
    </option>
  ));

  const aiView = (
    <>
      <div className="krowe-nt-scroll">
        <p className="krowe-nt-lede">Describe what you want built — krowe drafts the rest.</p>
        <div className="krowe-nt-inputwrap is-focus">
          <textarea
            className="krowe-nt-textarea krowe-nt-textarea-lg"
            autoFocus
            value={aiMode.kind === "input" ? aiMode.prompt : ""}
            onChange={(e) =>
              setAiMode((prev) =>
                prev.kind === "input" ? { ...prev, prompt: e.target.value } : prev
              )
            }
            placeholder='e.g. "Stripe checkout flow with webhook handling, a success page, and an email receipt."'
          />
        </div>
        <p className="krowe-nt-note">
          Don&rsquo;t overthink it. A sentence or two is fine — you can edit the draft before
          anything is created.
        </p>
      </div>
      <div className="krowe-nt-foot">
        <button type="button" className="krowe-nt-textbtn" onClick={toggleAi} disabled={isBusy}>
          <ArrowLeft width={13} height={13} /> Manual entry
        </button>
        <PrimaryBtn
          type="button"
          icon={<Ember size={14} />}
          kbd={kbdLabel}
          onClick={() => generate()}
          disabled={isBusy || !canGenerate}
        >
          Generate
        </PrimaryBtn>
      </div>
    </>
  );

  const loadingView = (
    <div className="krowe-nt-loading">
      <span className="krowe-nt-breathe">
        <Ember size={30} />
      </span>
      <p className="krowe-nt-loading-txt">Drafting your task…</p>
      <div className="krowe-nt-loadbar">
        <span />
      </div>
    </div>
  );

  const questionsView = aiFollowUp && (
    <>
      <div className="krowe-nt-scroll">
        {assumedCard({ strengthen: false })}
        <div className="krowe-nt-qblock">
          <p className="krowe-nt-q">{aiFollowUp.question}</p>
          <div className="krowe-nt-chips">
            {[...aiFollowUp.options, OTHER].map((opt) => {
              const on = followUpChoice === opt;
              const isOther = opt === OTHER;
              return (
                <button
                  key={opt}
                  type="button"
                  className={`krowe-nt-chip${on ? " is-on" : ""}`}
                  onClick={() => setFollowUpChoice(opt)}
                  disabled={isBusy}
                >
                  {on && <Ember size={12} />}
                  {isOther ? "Other…" : opt}
                </button>
              );
            })}
          </div>
          {followUpChoice === OTHER && (
            <div className="krowe-nt-inputwrap">
              <textarea
                className="krowe-nt-textarea"
                autoFocus
                rows={2}
                value={followUpOther}
                onChange={(e) => setFollowUpOther(e.target.value)}
                placeholder="Your answer…"
              />
            </div>
          )}
        </div>
      </div>
      <div className="krowe-nt-foot">
        <button
          type="button"
          className="krowe-nt-textbtn"
          onClick={() => setFollowUpOpen(false)}
          disabled={isBusy}
        >
          Cancel
        </button>
        <PrimaryBtn
          type="button"
          icon={<Ember size={14} />}
          onClick={submitFollowUp}
          disabled={
            isBusy ||
            !followUpChoice ||
            (followUpChoice === OTHER && followUpOther.trim().length < 2)
          }
        >
          Strengthen draft
        </PrimaryBtn>
      </div>
    </>
  );

  // The AI-classified change type, shown as a correctable pill on the review
  // screen. Falls back to "change" (mirrors the schema default) if unset.
  const reviewType = aiType ?? "change";
  const TypeIcon = TYPES.find((t) => t.value === reviewType)!.icon;

  // Selected-option labels for the pill sizers: a native <select> always sizes
  // to its widest option, so each pill stacks the select over a hidden span of
  // the *current* label and hugs that instead.
  const clientLabel =
    engagements.find((eng) => eng.id === selectedEngagement)?.title ?? "Personal (no client)";
  const typeLabel = TYPES.find((t) => t.value === reviewType)!.label;
  const priorityLabel = PRIORITIES.find((p) => p.value === priority)!.label;

  const reviewView = (
    <form ref={formRef} onSubmit={handleSubmit} className="krowe-nt-form">
      <div className="krowe-nt-scroll">
        <div className="krowe-nt-pillrow">
          <div className="krowe-nt-pillgroup">
            {engagements.length > 1 && (
              <span className="krowe-nt-pill">
                <Building2 width={12} height={12} />
                <span className="krowe-nt-pillfit">
                  <select
                    className="krowe-nt-pillsel"
                    aria-label="Client"
                    value={selectedEngagement}
                    onChange={(e) => setEngagementChoice(e.target.value)}
                  >
                    {clientOptions}
                  </select>
                  <span className="krowe-nt-pillsizer" aria-hidden="true">
                    {clientLabel}
                  </span>
                </span>
                <ChevronDown width={12} height={12} />
              </span>
            )}
            <span className="krowe-nt-pill krowe-nt-typepill" data-type={reviewType}>
              <TypeIcon width={12} height={12} strokeWidth={2.25} />
              <span className="krowe-nt-pillfit">
                <select
                  className="krowe-nt-pillsel"
                  aria-label="Type"
                  value={reviewType}
                  onChange={(e) => setAiType(e.target.value as TaskType)}
                >
                  {TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <span className="krowe-nt-pillsizer" aria-hidden="true">
                  {typeLabel}
                </span>
              </span>
              <ChevronDown width={12} height={12} />
            </span>
            <span className="krowe-nt-pill">
              <span className="krowe-nt-dot" data-priority={priority} />
              <span className="krowe-nt-pillfit">
                <select
                  className="krowe-nt-pillsel"
                  aria-label="Priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as TaskPriority)}
                >
                  {priorityOptions}
                </select>
                <span className="krowe-nt-pillsizer" aria-hidden="true">
                  {priorityLabel}
                </span>
              </span>
              <ChevronDown width={12} height={12} />
            </span>
          </div>
        </div>
        <div className="krowe-nt-field">
          <span className="krowe-nt-flabel">Description</span>
          <div className="krowe-nt-inputwrap">
            <textarea
              className="krowe-nt-textarea krowe-nt-desc"
              name="description"
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="More context (optional)"
            />
          </div>
        </div>
        {assumedCard({ strengthen: true })}
        <div className="krowe-nt-attach">
          <button
            type="button"
            className="krowe-nt-textbtn"
            onClick={() => generate()}
            disabled={isBusy}
          >
            <RefreshCw width={13} height={13} /> Regenerate
          </button>
          <button
            type="button"
            className="krowe-nt-textbtn"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip width={13} height={13} /> Add file
          </button>
        </div>
        {fileList}
        {error && <p className="krowe-nt-error">{error}</p>}
      </div>
      <div className="krowe-nt-foot krowe-nt-foot-solo">
        <PrimaryBtn
          type="submit"
          icon={<Check width={15} height={15} strokeWidth={2} />}
          kbd={kbdLabel}
          full
          disabled={isBusy}
        >
          {isBusy ? "Creating…" : "Create task"}
        </PrimaryBtn>
      </div>
    </form>
  );

  const manualView = (
    <form ref={formRef} onSubmit={handleSubmit} className="krowe-nt-form">
      <div className="krowe-nt-scroll">
        <div className="krowe-nt-inputwrap">
          <input
            className="krowe-nt-input"
            name="title"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={placeholder ?? "What needs to be built or fixed?"}
            required
          />
        </div>
        <div className="krowe-nt-inputwrap">
          <textarea
            className="krowe-nt-textarea"
            name="description"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="More context (optional)"
          />
        </div>
        <div className="krowe-nt-ai-row">
          <span className="krowe-nt-ai-row-l">Or let krowe flesh it out</span>
          <button type="button" className="krowe-nt-ghostpill" onClick={toggleAi} disabled={isBusy}>
            <Ember size={13} /> Generate with AI
          </button>
        </div>
        <div className="krowe-nt-metagrid">
          {engagements.length > 1 && (
            <label className="krowe-nt-field">
              <span className="krowe-nt-flabel">Client</span>
              <div className="krowe-nt-selwrap">
                <select
                  className="krowe-nt-select"
                  name="engagement"
                  value={selectedEngagement}
                  onChange={(e) => setEngagementChoice(e.target.value)}
                >
                  {clientOptions}
                </select>
                <ChevronDown width={15} height={15} />
              </div>
            </label>
          )}
          <label className="krowe-nt-field">
            <span className="krowe-nt-flabel">Priority</span>
            <div className="krowe-nt-selwrap">
              <select
                className="krowe-nt-select"
                name="priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
              >
                {priorityOptions}
              </select>
              <ChevronDown width={15} height={15} />
            </div>
          </label>
        </div>
        {attachments}
        {error && <p className="krowe-nt-error">{error}</p>}
      </div>
      <div className="krowe-nt-foot krowe-nt-foot-solo">
        <PrimaryBtn
          type="submit"
          icon={<Plus width={15} height={15} strokeWidth={2} />}
          kbd={kbdLabel}
          full
          disabled={isBusy}
        >
          {isBusy ? "Adding…" : "Add task"}
        </PrimaryBtn>
      </div>
    </form>
  );

  const panel = (
    <div className={`krowe-nt-panel ${modal ? "krowe-nt-panel-modal" : "krowe-nt-panel-dock"}`}>
      {header}
      {view === "ai" && aiView}
      {view === "loading" && loadingView}
      {view === "questions" && questionsView}
      {view === "review" && reviewView}
      {view === "manual" && manualView}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );

  return (
    <>
      {expanded && modal && (
        <div
          className="krowe-nt-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) handleClose();
          }}
        >
          {panel}
        </div>
      )}

      <div data-tour={tourId} className="krowe-nt-dock">
        {expanded && !modal && panel}
        <button
          type="button"
          className="krowe-nt-fab"
          onClick={() => (expanded ? handleClose() : setExpanded(true))}
          aria-label={expanded ? "Close" : "New task"}
        >
          <span className="krowe-nt-fab-ring" aria-hidden="true" />
          <span className={`krowe-nt-fab-plus${expanded ? " is-open" : ""}`}>
            <Plus width={22} height={22} strokeWidth={2} />
          </span>
        </button>
      </div>
    </>
  );
}
