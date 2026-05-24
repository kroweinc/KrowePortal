"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { simplifyOperatorTasks } from "@/lib/actions/simplify-tasks";
import type { Task, Subtask } from "@/lib/types";

const STORAGE_KEY = "plainEnglish";

interface TaskCacheEntry {
  title: string;
  description: string | null;
}

interface PlainEnglishContextValue {
  enabled: boolean;
  toggle: () => void;
  loadingCount: number;
  getTaskView: (task: Task) => { title: string; description: string | null; simplified: boolean };
  getSubtaskView: (subtask: Subtask) => { title: string; simplified: boolean };
  ensureTaskCached: (task: Task) => void;
  registerSubtasks: (task: Task, subtasks: Subtask[]) => void;
}

const PlainEnglishContext = createContext<PlainEnglishContextValue | null>(null);

function taskKey(task: { id: string; updated_at: string }) {
  return `${task.id}:${task.updated_at}`;
}

function subtaskKey(subtask: { id: string; updated_at: string }) {
  return `${subtask.id}:${subtask.updated_at}`;
}

interface ProviderProps {
  children: React.ReactNode;
}

export function PlainEnglishProvider({ children }: ProviderProps) {
  const [enabled, setEnabled] = useState<boolean>(false);
  const [taskCache, setTaskCache] = useState<Map<string, TaskCacheEntry>>(
    () => new Map()
  );
  const [subtaskCache, setSubtaskCache] = useState<Map<string, string>>(
    () => new Map()
  );
  const [loadingCount, setLoadingCount] = useState(0);
  const inFlightTasks = useRef<Set<string>>(new Set());
  const inFlightSubtaskBatches = useRef<Set<string>>(new Set());

  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (stored === "true") setEnabled(true);
  }, []);

  const runTaskFetch = useCallback(async (task: Task) => {
    const key = taskKey(task);
    if (inFlightTasks.current.has(key)) return;
    inFlightTasks.current.add(key);
    setLoadingCount((n) => n + 1);

    try {
      const result = await simplifyOperatorTasks({
        tasks: [
          {
            id: task.id,
            title: task.title,
            description: task.description,
            subtasks: [],
          },
        ],
      });
      if ("error" in result) {
        toast.error(result.error);
        setEnabled(false);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(STORAGE_KEY, "false");
        }
        return;
      }
      const entry = result.items.find((i) => i.id === task.id);
      if (!entry) return;
      setTaskCache((prev) => {
        const next = new Map(prev);
        next.set(key, {
          title: entry.simpleTitle,
          description: entry.simpleDescription,
        });
        return next;
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to simplify task");
      setEnabled(false);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, "false");
      }
    } finally {
      inFlightTasks.current.delete(key);
      setLoadingCount((n) => Math.max(0, n - 1));
    }
  }, []);

  const runSubtaskBatch = useCallback(
    async (task: Task, subtasks: Subtask[]) => {
      const batchKey = `${task.id}:subtasks:${subtasks.map(subtaskKey).join(",")}`;
      if (inFlightSubtaskBatches.current.has(batchKey)) return;
      inFlightSubtaskBatches.current.add(batchKey);
      setLoadingCount((n) => n + 1);

      try {
        const result = await simplifyOperatorTasks({
          tasks: [
            {
              id: task.id,
              title: task.title,
              description: task.description,
              subtasks: subtasks.map((s) => ({ id: s.id, title: s.title })),
            },
          ],
        });
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        const entry = result.items.find((i) => i.id === task.id);
        if (!entry) return;

        setTaskCache((prev) => {
          const next = new Map(prev);
          next.set(taskKey(task), {
            title: entry.simpleTitle,
            description: entry.simpleDescription,
          });
          return next;
        });

        setSubtaskCache((prev) => {
          const next = new Map(prev);
          for (const s of entry.simpleSubtasks) {
            const original = subtasks.find((sub) => sub.id === s.id);
            if (!original) continue;
            next.set(subtaskKey(original), s.simpleTitle);
          }
          return next;
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to simplify subtasks");
      } finally {
        inFlightSubtaskBatches.current.delete(batchKey);
        setLoadingCount((n) => Math.max(0, n - 1));
      }
    },
    []
  );

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, next ? "true" : "false");
      }
      return next;
    });
  }, []);

  const ensureTaskCached = useCallback(
    (task: Task) => {
      if (!enabled) return;
      if (taskCache.has(taskKey(task))) return;
      void runTaskFetch(task);
    },
    [enabled, taskCache, runTaskFetch]
  );

  const getTaskView = useCallback(
    (task: Task) => {
      if (!enabled) {
        return { title: task.title, description: task.description, simplified: false };
      }
      const cached = taskCache.get(taskKey(task));
      if (!cached) {
        return { title: task.title, description: task.description, simplified: false };
      }
      return { title: cached.title, description: cached.description, simplified: true };
    },
    [enabled, taskCache]
  );

  const getSubtaskView = useCallback(
    (subtask: Subtask) => {
      if (!enabled) return { title: subtask.title, simplified: false };
      const cached = subtaskCache.get(subtaskKey(subtask));
      if (!cached) return { title: subtask.title, simplified: false };
      return { title: cached, simplified: true };
    },
    [enabled, subtaskCache]
  );

  const registerSubtasks = useCallback(
    (task: Task, subtasks: Subtask[]) => {
      if (!enabled) return;
      const missing = subtasks.filter((s) => !subtaskCache.has(subtaskKey(s)));
      if (missing.length === 0) return;
      void runSubtaskBatch(task, subtasks);
    },
    [enabled, subtaskCache, runSubtaskBatch]
  );

  const value = useMemo<PlainEnglishContextValue>(
    () => ({
      enabled,
      toggle,
      loadingCount,
      getTaskView,
      getSubtaskView,
      ensureTaskCached,
      registerSubtasks,
    }),
    [enabled, toggle, loadingCount, getTaskView, getSubtaskView, ensureTaskCached, registerSubtasks]
  );

  return (
    <PlainEnglishContext.Provider value={value}>
      {children}
    </PlainEnglishContext.Provider>
  );
}

export function usePlainEnglish(): PlainEnglishContextValue {
  const ctx = useContext(PlainEnglishContext);
  if (!ctx) {
    return {
      enabled: false,
      toggle: () => {},
      loadingCount: 0,
      getTaskView: (task) => ({
        title: task.title,
        description: task.description,
        simplified: false,
      }),
      getSubtaskView: (subtask) => ({ title: subtask.title, simplified: false }),
      ensureTaskCached: () => {},
      registerSubtasks: () => {},
    };
  }
  return ctx;
}

export function useTaskView(task: Task) {
  return usePlainEnglish().getTaskView(task);
}

export function useSubtaskView(subtask: Subtask) {
  return usePlainEnglish().getSubtaskView(subtask);
}
