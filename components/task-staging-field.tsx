"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  getStagingGroups,
  createStagingGroup,
  assignTaskStagingGroup,
} from "@/lib/actions/staging-groups";
import type { StagingGroup } from "@/lib/types";

interface Props {
  taskId: string;
  engagementId: string;
  groupId: string | null;
  groupName: string | null;
  // Operators view deliverables read-only.
  readOnly?: boolean;
  // Groups preloaded by the server page so the chips paint with no fetch.
  groups?: StagingGroup[];
}

/**
 * Assign a done task to a builder-created staging group — a per-engagement
 * bucket independent of the git branch. Both can be set on the same task.
 * Editing swaps the pill for group chips plus an inline "New group" input.
 */
export function TaskStagingField({
  taskId,
  engagementId,
  groupId,
  groupName,
  readOnly,
  groups: preloaded,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [groups, setGroups] = useState<StagingGroup[]>(preloaded ?? []);
  const [loaded, setLoaded] = useState<boolean>(preloaded !== undefined);
  const [selectedId, setSelectedId] = useState<string | null>(groupId);
  const [selectedName, setSelectedName] = useState<string | null>(groupName);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [isPending, startTransition] = useTransition();

  function openEditor() {
    setEditing(true);
    if (loaded) return;
    getStagingGroups(engagementId)
      .then((gs) => {
        setGroups(gs);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }

  function assign(id: string | null, name: string | null) {
    setSelectedId(id);
    setSelectedName(name);
    startTransition(async () => {
      const res = await assignTaskStagingGroup(taskId, id);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    startTransition(async () => {
      const res = await createStagingGroup(engagementId, name);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setGroups((g) => [...g, res.group]);
      setNewName("");
      setCreating(false);
      const assignRes = await assignTaskStagingGroup(taskId, res.group.id);
      if ("error" in assignRes) {
        toast.error(assignRes.error);
        return;
      }
      setSelectedId(res.group.id);
      setSelectedName(res.group.name);
      setEditing(false);
      router.refresh();
    });
  }

  if (editing && !readOnly) {
    return (
      <div className="krowe-staging-picker">
        <div className="krowe-staging-chips">
          {groups.map((g) => (
            <button
              key={g.id}
              type="button"
              className={`krowe-staging-chip${selectedId === g.id ? " active" : ""}`}
              aria-pressed={selectedId === g.id}
              disabled={isPending}
              onClick={() => assign(g.id, g.name)}
            >
              <Layers className="h-3.5 w-3.5" />
              {g.name}
            </button>
          ))}
          <button
            type="button"
            className={`krowe-staging-chip${selectedId === null ? " active" : ""}`}
            aria-pressed={selectedId === null}
            disabled={isPending}
            onClick={() => assign(null, null)}
          >
            No group
          </button>
          {!creating && (
            <button
              type="button"
              className="krowe-staging-chip"
              disabled={isPending}
              onClick={() => setCreating(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              New group
            </button>
          )}
        </div>

        {creating && (
          <div className="krowe-staging-new">
            <input
              aria-label="New staging group name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Group name (e.g. Release 1.2)"
              maxLength={80}
              disabled={isPending}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCreate();
                } else if (e.key === "Escape") {
                  setCreating(false);
                  setNewName("");
                }
              }}
            />
            <button
              type="button"
              className="krowe-staging-chip active"
              disabled={isPending || !newName.trim()}
              onClick={handleCreate}
            >
              Add group
            </button>
            <button
              type="button"
              className="krowe-staging-cancel"
              disabled={isPending}
              onClick={() => {
                setCreating(false);
                setNewName("");
              }}
            >
              Cancel
            </button>
          </div>
        )}

        <button
          type="button"
          className="krowe-staging-cancel"
          onClick={() => setEditing(false)}
          disabled={isPending}
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="krowe-staging-field">
      <span
        className="krowe-staging-pill"
        data-empty={selectedName ? undefined : "true"}
      >
        <Layers className="h-3.5 w-3.5" />
        {selectedName ?? "No group"}
      </span>
      {!readOnly && (
        <button
          type="button"
          className="krowe-staging-edit"
          onClick={openEditor}
        >
          <Pencil className="h-3 w-3" />
          {selectedName ? "Change" : "Set group"}
        </button>
      )}
    </div>
  );
}
