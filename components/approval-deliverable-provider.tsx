"use client";

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react";
import { ApprovalDeliverableDialog } from "@/components/approval-deliverable-dialog";
import type { Task } from "@/lib/types";

type RequestApprovalOptions = {
  task: Pick<Task, "id" | "title">;
  onCommit?: () => void;
  onCancel?: () => void;
};

type RequestApprovalFn = (opts: RequestApprovalOptions) => void;

const ApprovalDeliverableContext = createContext<RequestApprovalFn | null>(null);

export function ApprovalDeliverableProvider({ children }: { children: ReactNode }) {
  const [pendingTask, setPendingTask] = useState<Pick<Task, "id" | "title"> | null>(null);
  const callbacksRef = useRef<{ onCommit?: () => void; onCancel?: () => void }>({});
  const committedRef = useRef(false);

  const requestApproval = useCallback<RequestApprovalFn>(({ task, onCommit, onCancel }) => {
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
    <ApprovalDeliverableContext.Provider value={requestApproval}>
      {children}
      <ApprovalDeliverableDialog
        open={!!pendingTask}
        onOpenChange={handleOpenChange}
        task={pendingTask}
        onSaved={handleSaved}
      />
    </ApprovalDeliverableContext.Provider>
  );
}

export function useRequestApproval(): RequestApprovalFn {
  const ctx = useContext(ApprovalDeliverableContext);
  if (!ctx) throw new Error("useRequestApproval must be used within ApprovalDeliverableProvider");
  return ctx;
}
