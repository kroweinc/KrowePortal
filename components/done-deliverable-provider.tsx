"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useTransition,
  type ReactNode,
} from "react";
import { DoneDeliverableDialog } from "@/components/done-deliverable-dialog";
import {
  commitDoneDeliverable,
  type DonePayload,
} from "@/lib/tasks/commit-done-deliverable";
import type { PreloadedBranches } from "@/lib/actions/get-engagement-branches";
import type { Task } from "@/lib/types";

type PendingTask = Pick<Task, "id" | "title" | "engagement_id" | "branch_name" | "work_kind">;

type RequestDoneOptions = {
  task: PendingTask;
  // Caller-owned commit. When provided, the provider just closes the dialog and
  // hands over the collected payload; the caller runs the write inside its OWN
  // optimistic transition so the card paints "done" instantly and holds until
  // the server reconciles. Sites without a local task list omit this and let the
  // provider commit + revalidate for them.
  onSubmit?: (payload: DonePayload) => void;
  // Fallback path only: fired after the provider's own commit succeeds.
  onCommit?: () => void;
  // Dialog dismissed without saving (also fired if the fallback commit fails).
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
  const callbacksRef = useRef<Omit<RequestDoneOptions, "task">>({});
  const committedRef = useRef(false);
  const [, startTransition] = useTransition();

  const requestDone = useCallback<RequestDoneFn>(({ task, onSubmit, onCommit, onCancel }) => {
    committedRef.current = false;
    callbacksRef.current = { onSubmit, onCommit, onCancel };
    setPendingTask(task);
  }, []);

  function handleSubmit(payload: DonePayload) {
    const task = pendingTask;
    if (!task) return;
    committedRef.current = true;
    const { onSubmit, onCommit, onCancel } = callbacksRef.current;
    callbacksRef.current = {};
    setPendingTask(null);

    if (onSubmit) {
      // Caller owns the commit (optimistic paint + its own transition).
      onSubmit(payload);
      return;
    }

    // Fallback: no local list to paint, so commit here and reconcile via the
    // revalidate the action triggers. Still closes instantly — the write runs
    // in the background transition.
    startTransition(async () => {
      const res = await commitDoneDeliverable(task, payload);
      if (res.ok) onCommit?.();
      else onCancel?.();
    });
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
        onSubmit={handleSubmit}
      />
    </DoneDeliverableContext.Provider>
  );
}

export function useRequestDone(): RequestDoneFn {
  const ctx = useContext(DoneDeliverableContext);
  if (!ctx) throw new Error("useRequestDone must be used within DoneDeliverableProvider");
  return ctx;
}
