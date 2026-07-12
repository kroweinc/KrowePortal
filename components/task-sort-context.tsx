"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { GrSelect } from "@/components/granola/gr-select";
import { TASK_SORT_OPTIONS, type TaskSortKey } from "@/lib/utils";

const SORT_STORAGE_KEY = "krowe:board-sort";

type TaskSortContextValue = { sortKey: TaskSortKey; setSort: (value: TaskSortKey) => void };

const TaskSortContext = createContext<TaskSortContextValue | null>(null);

/** Owns the board's sort preference so the Sort control can live in the page
 *  header (next to Staging / Tasks from meeting) while the board — a sibling
 *  subtree — reads the same value. Sort is a personal view preference, so it
 *  lives in client state (persisted to localStorage) rather than the URL:
 *  reordering is instant instead of paying a server round-trip on this Server
 *  Component route. */
export function TaskSortProvider({ children }: { children: React.ReactNode }) {
  const [sortKey, setSortKey] = useState<TaskSortKey>("default");
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SORT_STORAGE_KEY) as TaskSortKey | null;
      if (stored && TASK_SORT_OPTIONS.some((o) => o.value === stored)) setSortKey(stored);
    } catch {
      /* storage disabled — keep the default */
    }
  }, []);

  function setSort(value: TaskSortKey) {
    setSortKey(value);
    try {
      localStorage.setItem(SORT_STORAGE_KEY, value);
    } catch {
      /* storage disabled — session-only sort is fine */
    }
  }

  return (
    <TaskSortContext.Provider value={{ sortKey, setSort }}>
      {children}
    </TaskSortContext.Provider>
  );
}

export function useTaskSort(): TaskSortContextValue {
  const ctx = useContext(TaskSortContext);
  if (!ctx) throw new Error("useTaskSort must be used within a TaskSortProvider");
  return ctx;
}

/** The Sort dropdown. Rendered in the board header actions row so it sits next
 *  to Staging / Tasks from meeting instead of on its own line below. */
export function TaskSortControl() {
  const { sortKey, setSort } = useTaskSort();
  return (
    <label className="krowe-sort">
      <span className="krowe-sort-label">Sort</span>
      <GrSelect
        value={sortKey}
        onChange={(v) => setSort(v as TaskSortKey)}
        options={TASK_SORT_OPTIONS}
        ariaLabel="Sort tasks"
      />
    </label>
  );
}
