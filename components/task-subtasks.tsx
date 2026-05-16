"use client";

import { Fragment, useRef, useState, useTransition, useEffect } from "react";
import { toast } from "sonner";
import { ListTodo, Plus, X, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createSubtask,
  toggleSubtask,
  updateSubtaskTitle,
  deleteSubtask,
  reorderSubtasks,
} from "@/lib/actions/subtasks";
import type { Subtask } from "@/lib/types";
import { cn } from "@/lib/utils";

interface TaskSubtasksProps {
  taskId: string;
  initial?: Subtask[];
}

export function TaskSubtasks({ taskId, initial = [] }: TaskSubtasksProps) {
  const [subtasks, setSubtasks] = useState<Subtask[]>(initial);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [isPending, startTransition] = useTransition();
  const addInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

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
      const result = await deleteSubtask(id);
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
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          <ListTodo className="h-3 w-3" />
          Sub-tasks
          {subtasks.length > 0 && (
            <span className="font-normal text-neutral-400">
              ({done}/{subtasks.length})
            </span>
          )}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs text-neutral-400 hover:text-neutral-700"
          onClick={() => setAdding(true)}
          disabled={isPending}
        >
          <Plus className="mr-1 h-3 w-3" />
          Add
        </Button>
      </div>

      {subtasks.length === 0 && !adding ? (
        <p className="py-1 text-xs text-neutral-400">No sub-tasks yet</p>
      ) : (
        <ul>
          {subtasks.map((subtask, index) => (
            <Fragment key={subtask.id}>
              {dropLineIndex === index && (
                <li
                  aria-hidden
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDrop}
                  className="h-0.5 rounded-full bg-blue-400 mx-2 my-0.5"
                />
              )}
              <li
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
                className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-neutral-50"
              >
                <GripVertical className="h-3 w-3 shrink-0 cursor-grab text-neutral-300 opacity-0 group-hover:opacity-100 active:cursor-grabbing" />

                <input
                  type="checkbox"
                  checked={subtask.completed}
                  onChange={() => handleToggle(subtask)}
                  disabled={isPending}
                  className="h-3.5 w-3.5 shrink-0 accent-neutral-700 cursor-pointer"
                />

                {editingId === subtask.id ? (
                  <input
                    ref={editInputRef}
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onBlur={() => commitEdit(subtask)}
                    onKeyDown={(e) => handleEditKeyDown(e, subtask)}
                    className="min-w-0 flex-1 rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-xs text-neutral-900 outline-none focus:border-neutral-900"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => startEdit(subtask)}
                    className={cn(
                      "min-w-0 flex-1 text-left cursor-text rounded px-1 py-0.5 -mx-1 transition-colors hover:bg-neutral-100",
                      subtask.completed
                        ? "text-neutral-400 line-through"
                        : "text-neutral-700"
                    )}
                  >
                    {subtask.title}
                  </button>
                )}

                <button
                  onClick={() => handleDelete(subtask.id)}
                  disabled={isPending}
                  title="Delete"
                  className="shrink-0 rounded p-0.5 text-neutral-300 opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-500"
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
              className="h-0.5 rounded-full bg-blue-400 mx-2 my-0.5"
            />
          )}
        </ul>
      )}

      {adding && (
        <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
          <div className="h-3 w-3 shrink-0" />
          <div className="h-3.5 w-3.5 shrink-0 rounded border border-neutral-300" />
          <input
            ref={addInputRef}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onBlur={submitNew}
            onKeyDown={handleAddKeyDown}
            placeholder="Sub-task title…"
            className="min-w-0 flex-1 rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-xs text-neutral-900 outline-none focus:border-neutral-900 placeholder:text-neutral-400"
          />
        </div>
      )}
    </div>
  );
}
