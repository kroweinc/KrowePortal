"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  ArrowRight,
  Check,
  CornerDownRight,
  Loader2,
  Lock,
  Minus,
  Plus,
  RefreshCw,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { regenerateTask, type TaskRegenerationProposal } from "@/lib/actions/ai-tasks";
import { applyTaskRegeneration } from "@/lib/actions/tasks";
import type { ReconciledSubtask } from "@/lib/tasks/reconcile-subtask-plan";

type Mode = "collapsed" | "composing" | "loading" | "preview" | "applying";

const MAX_NOTE = 1000;

export function TaskRegenerate({
  taskId,
  onApplied,
}: {
  taskId: string;
  /** Called after the rewrite is persisted so the sheet can refresh. */
  onApplied: () => void;
}) {
  const [mode, setMode] = useState<Mode>("collapsed");
  const [note, setNote] = useState("");
  const [proposal, setProposal] = useState<TaskRegenerationProposal | null>(null);

  const busy = mode === "loading" || mode === "applying";

  async function runRegenerate() {
    const changeNote = note.trim();
    if (changeNote.length < 3) {
      toast.error("Describe what changed in a few words.");
      return;
    }
    setMode("loading");
    try {
      const result = await regenerateTask(taskId, changeNote);
      if ("error" in result) {
        toast.error(result.error);
        setMode("composing");
        return;
      }
      setProposal(result.proposal);
      setMode("preview");
    } catch {
      toast.error("Couldn't regenerate the task. Please try again.");
      setMode("composing");
    }
  }

  async function applyProposal() {
    if (!proposal) return;
    setMode("applying");
    try {
      const result = await applyTaskRegeneration({
        taskId,
        changeNote: note.trim() || undefined,
        task: {
          title: proposal.task.title,
          description: proposal.task.description,
          priority: proposal.task.priority,
          type: proposal.task.type,
          tags: proposal.task.tags,
        },
        final: proposal.reconciliation.final,
        remove: proposal.reconciliation.remove,
      });
      if ("error" in result) {
        toast.error(result.error);
        setMode("preview");
        return;
      }
      toast.success("Task regenerated.");
      reset();
      onApplied();
    } catch {
      toast.error("Something went wrong applying the changes. Please try again.");
      setMode("preview");
    }
  }

  function reset() {
    setMode("collapsed");
    setNote("");
    setProposal(null);
  }

  // ── Collapsed ──
  if (mode === "collapsed") {
    return (
      <div className="krowe-task-regen">
        <p className="krowe-regen-hint">
          Scope changed? Describe what&rsquo;s different and regenerate this task to match.
        </p>
        <button
          type="button"
          className="krowe-regen-trigger"
          onClick={() => setMode("composing")}
        >
          <WandSparkles className="h-3.5 w-3.5" />
          Regenerate from a change
        </button>
      </div>
    );
  }

  // ── Preview ──
  if ((mode === "preview" || mode === "applying") && proposal) {
    const { task, reconciliation, hadSubtasks } = proposal;
    return (
      <div className="krowe-task-regen">
        <div className="krowe-regen-preview">
          <div className="krowe-regen-field">
            <span className="cap">New title</span>
            <p className="ttl">{task.title}</p>
          </div>
          <div className="krowe-regen-field">
            <span className="cap">New description</span>
            <p className="desc">{task.description}</p>
          </div>
          <div className="krowe-regen-chips">
            <span className={`krowe-regen-chip prio-${task.priority}`}>{task.priority}</span>
            <span className="krowe-regen-chip">{task.type}</span>
            {task.tags[0] && <span className="krowe-regen-chip">{task.tags[0]}</span>}
          </div>

          {hadSubtasks && (
            <div className="krowe-regen-subs" aria-label="Subtask changes">
              {reconciliation.final.map((s, i) => (
                <SubtaskRow key={`f-${i}`} sub={s} />
              ))}
              {reconciliation.remove.map((s, i) => (
                <div key={`r-${i}`} className="krowe-regen-sub remove">
                  <Minus className="h-3.5 w-3.5" />
                  <span className="t">{s.title}</span>
                  <span className="tag">removed</span>
                </div>
              ))}
            </div>
          )}

          {task.assumptions.length > 0 && (
            <ul className="krowe-regen-assumptions">
              {task.assumptions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="krowe-regen-foot">
          <button
            type="button"
            className="krowe-btn-pill ghost-danger"
            onClick={reset}
            disabled={busy}
          >
            Discard
          </button>
          <div className="right">
            <button
              type="button"
              className="krowe-mini-btn"
              onClick={() => setMode("composing")}
              disabled={busy}
            >
              <RefreshCw className="h-3 w-3" /> Regenerate again
            </button>
            <button
              type="button"
              className="krowe-btn-pill primary"
              onClick={applyProposal}
              disabled={busy}
            >
              {mode === "applying" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              {mode === "applying" ? "Applying…" : "Apply"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Composing / loading ──
  return (
    <div className="krowe-task-regen">
      <label className="krowe-regen-label" htmlFor="krowe-regen-note">
        What changed?
      </label>
      <textarea
        id="krowe-regen-note"
        className="krowe-regen-textarea"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="e.g. Only 3 of the UI screens now, not all of them"
        rows={3}
        maxLength={MAX_NOTE}
        disabled={busy}
        autoFocus
      />
      <div className="krowe-regen-actions">
        <button
          type="button"
          className="krowe-btn-pill primary"
          onClick={runRegenerate}
          disabled={busy || note.trim().length < 3}
        >
          {mode === "loading" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {mode === "loading" ? "Regenerating…" : "Regenerate"}
        </button>
        <button
          type="button"
          className="krowe-btn-pill ghost-danger"
          onClick={reset}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function SubtaskRow({ sub }: { sub: ReconciledSubtask }) {
  if (sub.op === "add") {
    return (
      <div className="krowe-regen-sub add">
        <Plus className="h-3.5 w-3.5" />
        <span className="t">{sub.title}</span>
        <span className="tag">new</span>
      </div>
    );
  }
  if (sub.op === "rename") {
    return (
      <div className="krowe-regen-sub rename">
        <CornerDownRight className="h-3.5 w-3.5" />
        <span className="t">
          <span className="old">{sub.from}</span>
          <ArrowRight className="h-3 w-3" />
          {sub.title}
        </span>
        <span className="tag">edited</span>
      </div>
    );
  }
  if (sub.op === "preserved") {
    return (
      <div className="krowe-regen-sub preserved">
        <Lock className="h-3.5 w-3.5" />
        <span className="t">{sub.title}</span>
        <span className="tag">kept — {sub.reason === "completed" ? "already done" : "has logged time"}</span>
      </div>
    );
  }
  // keep
  return (
    <div className="krowe-regen-sub keep">
      <span className="dot" aria-hidden />
      <span className="t">{sub.title}</span>
    </div>
  );
}
