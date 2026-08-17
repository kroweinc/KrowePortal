"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { GrSelect } from "@/components/granola/gr-select";
import { setBoardSort } from "@/lib/actions/board-sort";
import { TASK_SORT_OPTIONS, type TaskSortKey } from "@/lib/utils";

const SORT_STORAGE_KEY = "krowe:board-sort";

type TaskSortContextValue = { sortKey: TaskSortKey; setSort: (value: TaskSortKey) => void };

const TaskSortContext = createContext<TaskSortContextValue | null>(null);

/** Owns the board's sort preference so the Sort control can live in the page
 *  header (next to Staging / Tasks from meeting) while the board — a sibling
 *  subtree — reads the same value. Sort is a personal view preference, so it
 *  stays out of the URL: reordering is instant instead of paying a server
 *  round-trip on this Server Component route.
 *
 *  The choice is saved on the user's account (profiles.board_sort, 0090) and
 *  arrives as initialSort with the server render, so it follows them across
 *  browsers and machines. localStorage is kept as the same-browser mirror and,
 *  for anyone who set a sort before the column existed, the value we migrate
 *  onto the account on their next load. */
export function TaskSortProvider({
  initialSort,
  children,
}: {
  initialSort?: TaskSortKey | null;
  children: React.ReactNode;
}) {
  const [sortKey, setSortKey] = useState<TaskSortKey>(initialSort ?? "default");
  useEffect(() => {
    // The account value is authoritative; only reach for localStorage when
    // there isn't one yet — then write it back so this is the last load that
    // has to ask the browser.
    if (initialSort) return;
    try {
      const stored = localStorage.getItem(SORT_STORAGE_KEY) as TaskSortKey | null;
      if (stored && TASK_SORT_OPTIONS.some((o) => o.value === stored)) {
        setSortKey(stored);
        void setBoardSort(stored);
      }
    } catch {
      /* storage disabled — keep the default */
    }
  }, [initialSort]);

  function setSort(value: TaskSortKey) {
    setSortKey(value);
    void setBoardSort(value);
    try {
      localStorage.setItem(SORT_STORAGE_KEY, value);
    } catch {
      /* storage disabled — the account copy still carries it */
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
