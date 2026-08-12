"use client";

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react";
import {
  ApprovalDeliverableDialog,
  type ApprovalTask,
} from "@/components/approval-deliverable-dialog";
import type { PreloadedBranches } from "@/lib/actions/get-engagement-branches";

type RequestApprovalOptions = {
  task: ApprovalTask;
  onCommit?: () => void;
  onCancel?: () => void;
};

type RequestApprovalFn = (opts: RequestApprovalOptions) => void;

const ApprovalDeliverableContext = createContext<RequestApprovalFn | null>(null);

export function ApprovalDeliverableProvider({
  children,
  branchesByEngagement = {},
}: {
  children: ReactNode;
  branchesByEngagement?: Record<string, PreloadedBranches>;
}) {
  const [pendingTask, setPendingTask] = useState<ApprovalTask | null>(null);
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
        preloaded={
          pendingTask?.engagement_id
            ? branchesByEngagement[pendingTask.engagement_id]
            : undefined
        }
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
