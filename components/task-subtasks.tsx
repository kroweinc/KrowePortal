"use client";

import { Fragment, useRef, useState, useTransition, useEffect } from "react";
import { toast } from "sonner";
import { ListTodo, Plus, X, GripVertical } from "lucide-react";
import {
  createSubtask,
  toggleSubtask,
  updateSubtaskTitle,
  deleteSubtask,
  reorderSubtasks,
} from "@/lib/actions/subtasks";
import { AiSubtaskGeneratorDialog } from "@/components/ai-subtask-generator-dialog";
import { usePlainEnglish } from "@/components/plain-english-context";
import type { Subtask, Task } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatEstimate } from "@/lib/format-estimate";

interface TaskSubtasksProps {
  taskId: string;
  initial?: Subtask[];
  task?: Task;
}

export function TaskSubtasks({ taskId, initial = [], task }: TaskSubtasksProps) {
  const [subtasks, setSubtasks] = useState<Subtask[]>(initial);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [isPending, startTransition] = useTransition();
  const addInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const { enabled: plainEnabled, getSubtaskView, registerSubtasks } = usePlainEnglish();

  const dragSrcIndex = useRef<number | null>(null);
  const [dropLineIndex, setDropLineIndex] = useState<number | null>(null);

  useEffect(() => {
    if (initial.length > 0) return;
    fetch(`/api/subtasks?taskId=${taskId}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setSubtasks(data);
      })
      .catch(() => {});
  }, [taskId, initial.length]);

  useEffect(() => {
    if (!plainEnabled || !task || subtasks.length === 0) return;
    const real = subtasks.filter((s) => !s.id.startsWith("temp-"));
    if (real.length === 0) return;
    registerSubtasks(task, real);
  }, [plainEnabled, task, subtasks, registerSubtasks]);

  useEffect(() => {
    if (adding) addInputRef.current?.focus();
  }, [adding]);

  useEffect(() => {
    if (editingId) editInputRef.current?.focus();
  }, [editingId]);

  function handleAddKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      submitNew();
    } else if (e.key === "Escape") {
      setAdding(false);
      setNewTitle("");
    }
  }

  function submitNew() {
    const title = newTitle.trim();
    if (!title) {
      setAdding(false);
      setNewTitle("");
      return;
    }

    const tempId = `temp-${Date.now()}`;
    const optimistic: Subtask = {
      id: tempId,
      task_id: taskId,
      created_by: "",
      title,
      completed: false,
      position: subtasks.length,
      ai_est_low_min: null,
      ai_est_high_min: null,
      actual_hours: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setSubtasks((prev) => [...prev, optimistic]);
    setNewTitle("");
    setAdding(false);

    startTransition(async () => {
      const result = await createSubtask(taskId, title);
      if (result.error) {
        toast.error(result.error);
        setSubtasks((prev) => prev.filter((s) => s.id !== tempId));
      } else if (result.subtask) {
        setSubtasks((prev) =>
          prev.map((s) => (s.id === tempId ? result.subtask! : s))
        );
      }
    });
  }

  function handleToggle(subtask: Subtask) {
    const next = !subtask.completed;
    setSubtasks((prev) =>
      prev.map((s) => (s.id === subtask.id ? { ...s, completed: next } : s))
    );
    startTransition(async () => {
      const result = await toggleSubtask(subtask.id, next);
      if (result.error) {
        toast.error(result.error);
        setSubtasks((prev) =>
          prev.map((s) => (s.id === subtask.id ? { ...s, completed: subtask.completed } : s))
        );
      }
    });
  }

  function handleDelete(id: string) {
    const removed = subtasks.find((s) => s.id === id);
    setSubtasks((prev) => prev.filter((s) => s.id !== id));
    startTransition(async () => {
      const result = await deleteSubtask(id, taskId);
      if (result.error) {
        toast.error(result.error);
        if (removed) setSubtasks((prev) => [...prev, removed]);
      }
    });
  }

  function startEdit(subtask: Subtask) {
    setEditingId(subtask.id);
    setEditingTitle(subtask.title);
  }

  function commitEdit(subtask: Subtask) {
    const title = editingTitle.trim();
    setEditingId(null);
    if (!title || title === subtask.title) return;

    setSubtasks((prev) =>
      prev.map((s) => (s.id === subtask.id ? { ...s, title } : s))
    );
    startTransition(async () => {
      const result = await updateSubtaskTitle(subtask.id, title);
      if (result.error) {
        toast.error(result.error);
        setSubtasks((prev) =>
          prev.map((s) => (s.id === subtask.id ? { ...s, title: subtask.title } : s))
        );
      }
    });
  }

  function handleEditKeyDown(e: React.KeyboardEvent<HTMLInputElement>, subtask: Subtask) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitEdit(subtask);
    } else if (e.key === "Escape") {
      setEditingId(null);
      setEditingTitle("");
    }
  }

  function handleDragStart(index: number) {
    dragSrcIndex.current = index;
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    setDropLineIndex(e.clientY < midY ? index : index + 1);
  }

  function handleDrop() {
    const from = dragSrcIndex.current;
    const to = dropLineIndex;
    setDropLineIndex(null);
    dragSrcIndex.current = null;

    if (from === null || to === null || to === from || to === from + 1) return;

    const next = [...subtasks];
    const [moved] = next.splice(from, 1);
    next.splice(to > from ? to - 1 : to, 0, moved);
    setSubtasks(next);

    const updates = next.map((s, i) => ({ id: s.id, position: i }));
    startTransition(async () => {
      const result = await reorderSubtasks(updates);
      if (result.error) toast.error(result.error);
    });
  }

  function handleDragEnd() {
    dragSrcIndex.current = null;
    setDropLineIndex(null);
  }

  const done = subtasks.filter((s) => s.completed).length;

  return (
    <>
      <div className="krowe-subs-h">
        <div className="krowe-subs-progress">
          <ProgressRing done={done} total={subtasks.length} />
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.09em] text-neutral-500">
              <ListTodo className="h-3 w-3" />
              Sub-tasks
            </p>
            <p className="krowe-subs-meta">
              <strong>{done}</strong> of {subtasks.length} complete
            </p>
          </div>
        </div>
        <div className="krowe-subs-actions">
          <AiSubtaskGeneratorDialog
            taskId={taskId}
            onAccept={(newSubtasks) =>
              setSubtasks((prev) => [...prev, ...newSubtasks])
            }
            triggerClassName="krowe-mini-btn ai"
          />
          <button
            type="button"
            className="krowe-mini-btn"
            onClick={() => setAdding(true)}
            disabled={isPending}
          >
            <Plus className="h-3 w-3" /> Add
          </button>
        </div>
      </div>

      <ul className="krowe-sub-list">
        {subtasks.length === 0 && !adding && (
          <li className="px-3 py-2 text-xs italic text-neutral-400">
            No sub-tasks yet
          </li>
        )}

        {subtasks.map((subtask, index) => (
          <Fragment key={subtask.id}>
            {dropLineIndex === index && (
              <li
                aria-hidden
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                className="krowe-sub-droplane"
              />
            )}
            <li
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
              className={cn("krowe-sub-item", subtask.completed && "done")}
            >
              <span className="grip" aria-hidden>
                <GripVertical className="h-3.5 w-3.5" />
              </span>
              <label className="check">
                <input
                  type="checkbox"
                  checked={subtask.completed}
                  onChange={() => handleToggle(subtask)}
                  disabled={isPending}
                  aria-label={`Mark "${subtask.title}" as ${
                    subtask.completed ? "incomplete" : "complete"
                  }`}
                />
                {subtask.completed && (
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden
                  >
                    <path
                      d="M3.5 8.5l3 3 6-6.5"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </label>
              {editingId === subtask.id ? (
                <input
                  ref={editInputRef}
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onBlur={() => commitEdit(subtask)}
                  onKeyDown={(e) => handleEditKeyDown(e, subtask)}
                  className="stext min-w-0 flex-1 rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-[13.5px] text-neutral-900 outline-none focus:border-neutral-900"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => startEdit(subtask)}
                  className="stext text-left cursor-text"
                >
                  {getSubtaskView(subtask).title}
                </button>
              )}
              <EstimateChip subtask={subtask} />
              <button
                type="button"
                className="x"
                onClick={() => handleDelete(subtask.id)}
                disabled={isPending}
                title="Delete"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          </Fragment>
        ))}
        {dropLineIndex === subtasks.length && (
          <li
            aria-hidden
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            className="krowe-sub-droplane"
          />
        )}

        {adding && (
          <li className="krowe-sub-item">
            <span className="grip" aria-hidden />
            <span className="check" aria-hidden />
            <input
              ref={addInputRef}
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onBlur={submitNew}
              onKeyDown={handleAddKeyDown}
              placeholder="Sub-task title…"
              className="stext min-w-0 flex-1 rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-[13.5px] text-neutral-900 outline-none focus:border-neutral-900 placeholder:text-neutral-400"
            />
          </li>
        )}
      </ul>
    </>
  );
}

function ProgressRing({
  done,
  total,
  size = 32,
}: {
  done: number;
  total: number;
  size?: number;
}) {
  const r = size / 2 - 3;
  const C = 2 * Math.PI * r;
  const pct = total === 0 ? 0 : done / total;
  const offset = C * (1 - pct);
  return (
    <div className="krowe-progress-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle
          className="track"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={3}
        />
        <circle
          className="fill"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="pct">{Math.round(pct * 100)}</div>
    </div>
  );
}

function EstimateChip({ subtask }: { subtask: Subtask }) {
  const chip = formatEstimate(subtask.ai_est_low_min, subtask.ai_est_high_min);
  if (!chip) return null;
  return (
    <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-500">
      {chip}
    </span>
  );
}
