"use client";

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react";
import { DoneDeliverableDialog } from "@/components/done-deliverable-dialog";
import type { PreloadedBranches } from "@/lib/actions/get-engagement-branches";
import type { Task } from "@/lib/types";

type PendingTask = Pick<Task, "id" | "title" | "engagement_id">;

type RequestDoneOptions = {
  task: PendingTask;
  onCommit?: () => void;
  onCancel?: () => void;
};

type RequestDoneFn = (opts: RequestDoneOptions) => void;

const DoneDeliverableContext = createContext<RequestDoneFn | null>(null);

export function DoneDeliverableProvider({
  children,
  branchesByEngagement = {},
}: {
  children: ReactNode;
  branchesByEngagement?: Record<string, PreloadedBranches>;
}) {
  const [pendingTask, setPendingTask] = useState<PendingTask | null>(null);
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
        preloaded={
          pendingTask?.engagement_id
            ? branchesByEngagement[pendingTask.engagement_id]
            : undefined
        }
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
