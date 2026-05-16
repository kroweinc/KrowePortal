"use client";

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react";
import { DoneDeliverableDialog } from "@/components/done-deliverable-dialog";
import type { Task } from "@/lib/types";

type RequestDoneOptions = {
  task: Pick<Task, "id" | "title">;
  onCommit?: () => void;
  onCancel?: () => void;
};

type RequestDoneFn = (opts: RequestDoneOptions) => void;

const DoneDeliverableContext = createContext<RequestDoneFn | null>(null);

export function DoneDeliverableProvider({ children }: { children: ReactNode }) {
  const [pendingTask, setPendingTask] = useState<Pick<Task, "id" | "title"> | null>(null);
  const callbacksRef = useRef<{ onCommit?: () => void; onCancel?: () => void }>({});
  const committedRef = useRef(false);

  const requestDone = useCallback<RequestDoneFn>(({ task, onCommit, onCancel }) => {
    committedRef.current = false;
    callbacksRef.current = { onCommit, onCancel };
    setPendingTask(task);
  }, []);

  function handleSaved() {
    committedRef.current = true;
    const commitFn = callbacksRef.current.onCommit;
    callbacksRef.current = {};
    setPendingTask(null);
    commitFn?.();
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      if (!committedRef.current) {
        const cancelFn = callbacksRef.current.onCancel;
        callbacksRef.current = {};
        setPendingTask(null);
        cancelFn?.();
      }
      committedRef.current = false;
    }
  }

  return (
    <DoneDeliverableContext.Provider value={requestDone}>
      {children}
      <DoneDeliverableDialog
        open={!!pendingTask}
        onOpenChange={handleOpenChange}
        task={pendingTask}
        onSaved={handleSaved}
      />
    </DoneDeliverableContext.Provider>
  );
}

export function useRequestDone(): RequestDoneFn {
  const ctx = useContext(DoneDeliverableContext);
  if (!ctx) throw new Error("useRequestDone must be used within DoneDeliverableProvider");
  return ctx;
}
