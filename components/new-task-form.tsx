"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Plus, X, Paperclip, Maximize2, Minimize2, Sparkles, Loader2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { createTask } from "@/lib/actions/tasks";
import { uploadAttachment } from "@/lib/actions/attachments";
import { generateTaskDraft } from "@/lib/actions/ai-tasks";
import type { Question, TaskDraft } from "@/lib/ai/schemas";
import type { TaskPriority, TaskType } from "@/lib/types";
import { OPEN_NEW_TASK_EVENT } from "@/components/add-task-button";

const MAX_SIZE = 25 * 1024 * 1024;
const OTHER = "__other__";

// Drop any AI-supplied option that is itself a generic "Other"/"please specify"
// catch-all, since the UI always renders its own canonical OTHER choice. Without
// this, such an option renders twice.
const isRealOption = (opt: string) => {
  const o = opt.trim().toLowerCase();
  return o !== "other" && !o.includes("specify");
};

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

type AiMode =
  | { kind: "idle" }
  | { kind: "input"; prompt: string }
  | { kind: "loading" }
  | {
      kind: "questions";
      prompt: string;
      items: Question[];
      selections: Record<string, string>;
      otherText: Record<string, string>;
    };

export function NewTaskForm({ engagementId, engagements = [], placeholder, onSuccess, tourId }: NewTaskFormProps) {
  const [expanded, setExpanded] = useState(false);
  const [modal, setModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Default to the AI input the moment the "+" opens the form — the AI flow is
  // the primary path, with "Manual entry" available as an escape hatch. resetForm
  // returns here too, so every fresh open lands in AI mode.
  const [aiMode, setAiMode] = useState<AiMode>({ kind: "input", prompt: "" });
  const askedOnceRef = useRef(false);

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
    setAiMode({ kind: "input", prompt: "" });
    setFiles([]);
    setError(null);
    setEngagementChoice(undefined);
    askedOnceRef.current = false;
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
    setAiDrafted(true);
  }

  function generate(answers?: { questionId: string; answer: string }[]) {
    const raw =
      aiMode.kind === "input"
        ? aiMode.prompt.trim()
        : aiMode.kind === "questions"
          ? aiMode.prompt.trim()
          : [title.trim(), description.trim()].filter(Boolean).join("\n\n");
    if (raw.length < 5) {
      toast.error("Type a few words describing what you want first.");
      return;
    }

    setAiMode({ kind: "loading" });
    startTransition(async () => {
      const result = await generateTaskDraft({
        rawDescription: raw,
        engagementId: effectiveEngagementId,
        answers,
      });

      if ("error" in result) {
        toast.error(result.error);
        setAiMode({ kind: "idle" });
        return;
      }

      if (result.kind === "questions") {
        if (askedOnceRef.current) {
          toast.error("Couldn't build a task from this — add more detail and try again.");
          setAiMode({ kind: "idle" });
          return;
        }
        askedOnceRef.current = true;
        setAiMode({
          kind: "questions",
          prompt: raw,
          items: result.items,
          selections: Object.fromEntries(result.items.map((q) => [q.id, ""])),
          otherText: Object.fromEntries(result.items.map((q) => [q.id, ""])),
        });
      } else {
        applyDraft(result.item);
        setAiMode({ kind: "idle" });
      }
    });
  }

  function answerFor(
    q: Question,
    selections: Record<string, string>,
    otherText: Record<string, string>
  ): string {
    const sel = selections[q.id] ?? "";
    if (sel === OTHER) return (otherText[q.id] ?? "").trim();
    return sel;
  }

  function submitAnswers() {
    if (aiMode.kind !== "questions") return;
    const answers = aiMode.items.map((q) => ({
      questionId: q.id,
      answer: answerFor(q, aiMode.selections, aiMode.otherText),
    }));
    generate(answers);
  }

  const questionsReady =
    aiMode.kind === "questions" &&
    aiMode.items.every((q) => answerFor(q, aiMode.selections, aiMode.otherText).length > 0);

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
  const aiActive = aiMode.kind === "input";
  const canGenerate = aiActive
    ? aiMode.prompt.trim().length >= 5
    : (title.trim() + description.trim()).length >= 5;

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

  const header = (
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium text-neutral-900">
        {aiDrafted ? "Review AI draft" : "New task"}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setModal((v) => !v)}
          className="text-neutral-400 hover:text-neutral-700 transition-colors"
          aria-label={modal ? "Collapse" : "Expand"}
        >
          {modal ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={handleClose}
          className="text-neutral-400 hover:text-neutral-700 transition-colors"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  const questionsView = aiMode.kind === "questions" && (
    <div className="space-y-3">
      {header}
      <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
        <p className="text-xs text-neutral-500">
          A few quick questions so the AI can build the right task.
        </p>
        {aiMode.items.map((q) => {
          const selected = aiMode.selections[q.id] ?? "";
          return (
            <div key={q.id} className="space-y-2">
              <p className="text-sm font-medium text-neutral-800">{q.text}</p>
              <div className="space-y-1.5">
                {q.options.filter(isRealOption).map((opt) => (
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
                        setAiMode((prev) =>
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
                      setAiMode((prev) =>
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
                    value={aiMode.otherText[q.id] ?? ""}
                    onChange={(e) =>
                      setAiMode((prev) =>
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
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setAiMode({ kind: "idle" })}
        >
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          Back
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={submitAnswers}
          disabled={isBusy || !questionsReady}
        >
          {isBusy ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          )}
          Build task
        </Button>
      </div>
    </div>
  );

  const loadingView = aiMode.kind === "loading" && (
    <div className="space-y-3">
      {header}
      <div className="flex flex-col items-center justify-center gap-2 py-10">
        <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
        <p className="text-xs text-neutral-500">Drafting your task…</p>
      </div>
    </div>
  );

  const inputView = aiMode.kind === "input" && (
    <div className="space-y-3">
      {header}
      <Textarea
        autoFocus
        rows={modal ? 8 : 6}
        value={aiMode.prompt}
        onChange={(e) =>
          setAiMode((prev) =>
            prev.kind === "input" ? { ...prev, prompt: e.target.value } : prev
          )
        }
        placeholder='Describe what you want built. e.g. "Stripe checkout flow with webhook handling, success page, and email receipt."'
      />
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={toggleAi}
          disabled={isBusy}
          className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900 transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Manual entry
        </button>
        <Button
          type="button"
          size="sm"
          onClick={() => generate()}
          disabled={isBusy || !canGenerate}
        >
          {isBusy ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          )}
          Generate
        </Button>
      </div>
    </div>
  );

  const formView = aiMode.kind === "idle" && (
    <div className="space-y-3">
      {header}
      <form onSubmit={handleSubmit} className="space-y-3">
        <Input
          name="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={placeholder ?? "What needs to be built or fixed?"}
          required
          autoFocus
        />
        <Textarea
          name="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="More context (optional)"
          rows={modal ? 5 : 3}
        />

        <div className="flex items-center justify-between">
          <span className="text-xs text-neutral-500">
            {aiDrafted ? "AI draft — edit anything before creating" : "Or let AI flesh it out"}
          </span>
          {aiDrafted ? (
            <button
              type="button"
              onClick={() => generate()}
              disabled={isBusy}
              className="flex items-center gap-1 text-xs text-neutral-600 hover:text-neutral-900 disabled:text-neutral-300 transition-colors"
            >
              <Sparkles className="h-3 w-3" />
              Regenerate
            </button>
          ) : (
            <button
              type="button"
              onClick={toggleAi}
              disabled={isBusy}
              className="flex items-center gap-1 text-xs text-neutral-600 hover:text-neutral-900 disabled:text-neutral-300 transition-colors"
            >
              <Sparkles className="h-3 w-3" />
              Generate with AI
            </button>
          )}
        </div>

        {engagements.length > 1 && (
          <div>
            <label className="block text-xs font-medium text-neutral-700 mb-1">Client</label>
            <Select
              name="engagement"
              value={selectedEngagement}
              onChange={(e) => setEngagementChoice(e.target.value)}
            >
              {engagements.map((eng) => (
                <option key={eng.id} value={eng.id}>
                  {eng.title}
                </option>
              ))}
              <option value={PERSONAL}>Personal (no client)</option>
            </Select>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-1">Priority</label>
          <Select
            name="priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as TaskPriority)}
          >
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </Select>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-neutral-700">Attachments</label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-700 transition-colors"
            >
              <Paperclip className="h-3 w-3" />
              Add file
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={handleFileChange}
          />
          {files.length > 0 && (
            <ul className="space-y-1">
              {files.map((f, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-2 rounded-md border border-neutral-100 bg-neutral-50 px-2 py-1 text-xs"
                >
                  <span className="truncate text-neutral-700">{f.name}</span>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="shrink-0 text-neutral-400 hover:text-red-500 transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}
        <Button type="submit" size="sm" className="w-full" disabled={isBusy}>
          {isBusy ? "Adding…" : aiDrafted ? "Create task" : "Add task"}
        </Button>
      </form>
    </div>
  );

  const panelContent = questionsView || loadingView || inputView || formView;

  return (
    <>
      {expanded && modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm bg-black/30"
          onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
        >
          <div className="w-full max-w-lg rounded-2xl border border-neutral-200 bg-white shadow-2xl p-6 mx-4">
            {panelContent}
          </div>
        </div>
      )}

      <div data-tour={tourId} className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
        {expanded && !modal && (
          <div className="w-80 rounded-xl border border-neutral-200 bg-white shadow-xl p-4">
            {panelContent}
          </div>
        )}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-900 text-white shadow-lg hover:bg-neutral-700 transition-colors"
          aria-label="New task"
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>
    </>
  );
}
