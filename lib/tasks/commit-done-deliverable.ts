import { toast } from "sonner";
import { uploadAttachment } from "@/lib/actions/attachments";
import { markTaskDone } from "@/lib/actions/tasks";
import { linkTaskCommit } from "@/lib/actions/task-commits";
import type { PickedCommit } from "@/components/done-deliverable-dialog/commit-picker";
import type { Task } from "@/lib/types";

/**
 * Everything the "Mark as done" dialog collects, snapshotted so the caller can
 * close the dialog immediately and commit in the background.
 */
export type DonePayload = {
  core: {
    pushed_to_main: boolean;
    completion_note: string | null;
    branch_name: string | null;
  };
  files: File[];
  commits: PickedCommit[];
  // Whether the picked commits should actually be linked (only when the task
  // shipped on the default branch).
  linkCommits: boolean;
};

/**
 * Runs the full "done" commit off the render path: the status flip, any
 * deliverable uploads, and any commit links all fire together instead of the
 * old sequential await-chain, so the dialog can close the instant Save is
 * clicked while this settles in the background. The status flip is the only
 * result that gates success — attachments/commits degrade to a warning toast.
 *
 * Owns its own toasts (success / partial-failure) so every trigger site stays a
 * one-liner and only reacts to `ok` for optimistic rollback.
 */
export async function commitDoneDeliverable(
  task: Pick<Task, "id">,
  { core, files, commits, linkCommits }: DonePayload
): Promise<{ ok: boolean }> {
  const uploadFiles = () =>
    Promise.all(
      files.map(async (file) => {
        const fd = new FormData();
        fd.set("task_id", task.id);
        fd.set("file", file);
        fd.set("is_deliverable", "true");
        return { file, result: await uploadAttachment(fd) };
      })
    );

  type LinkOutcome = {
    commit: PickedCommit;
    result: { id: string } | { error: string };
  };
  const linkAll = (): Promise<LinkOutcome[]> =>
    linkCommits && commits.length > 0
      ? Promise.all(
          commits.map(async (commit) => ({
            commit,
            result: await linkTaskCommit(task.id, {
              sha: commit.sha,
              url: commit.html_url,
              message: commit.message,
              author_name: commit.author_name,
              author_login: commit.author_login,
              committed_at: commit.committed_at,
              repo_full_name: commit.repo_full_name,
            }),
          }))
        )
      : Promise.resolve([]);

  const [doneRes, fileOutcomes, commitOutcomes] = await Promise.all([
    markTaskDone(task.id, core),
    uploadFiles(),
    linkAll(),
  ]);

  if ("error" in doneRes) {
    toast.error(doneRes.error);
    return { ok: false };
  }

  const failedFiles = fileOutcomes.filter((o) => o.result.error);
  if (failedFiles.length > 0) {
    if (failedFiles.length === files.length) {
      toast.warning("Couldn't upload the attachment(s) — the task was still marked done.");
    } else {
      toast.warning(`${files.length - failedFiles.length} of ${files.length} files uploaded`);
    }
  }

  const failedCommits = commitOutcomes.filter((o) => "error" in o.result);
  if (failedCommits.length > 0) {
    toast.warning(`${commitOutcomes.length - failedCommits.length} of ${commitOutcomes.length} commits linked`);
  }

  toast.success("Task marked as done");
  return { ok: true };
}
