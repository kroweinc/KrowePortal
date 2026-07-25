"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

// Native HTML5 drag-reorder for the profile's card lists. Generalized from the
// subtask list (components/task-subtasks.tsx) — same interaction, same
// drop-lane semantics — so the profile needs no drag-and-drop dependency.
//
// The list order is optimistic: the caller paints the new order immediately and
// this hook persists the resulting id[] through the matching reorder* action.
// On failure it restores the order the server still believes in, so a dropped
// request can't leave the editor showing an order that isn't saved.

interface Identified {
  id: string;
}

interface DragReorderOptions<T extends Identified> {
  items: T[];
  /** Paint the new order now. Called before the server round-trip. */
  onReorder: (next: T[]) => void;
  /** The matching reorder* server action. Receives ids in display order. */
  persist: (orderedIds: string[]) => Promise<{ error?: string } | void>;
}

export function useDragReorder<T extends Identified>({
  items,
  onReorder,
  persist,
}: DragReorderOptions<T>) {
  const dragSrcIndex = useRef<number | null>(null);
  // Mirrored in a ref as well as state: state drives the drop-lane render, but
  // `drop` can land in the same tick as the `dragover` that set it, and a state
  // read there would still see the pre-render value and silently no-op.
  const dropIndexRef = useRef<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  function setDrop(next: number | null) {
    dropIndexRef.current = next;
    setDropIndex(next);
  }

  function reset() {
    dragSrcIndex.current = null;
    setDrop(null);
  }

  function handleDrop() {
    const from = dragSrcIndex.current;
    const to = dropIndexRef.current;
    reset();
    // to === from + 1 is a drop into the gap the item already occupies.
    if (from === null || to === null || to === from || to === from + 1) return;

    const previous = items;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to > from ? to - 1 : to, 0, moved);
    onReorder(next);

    startTransition(async () => {
      const result = await persist(next.map((item) => item.id));
      if (result && result.error) {
        onReorder(previous);
        toast.error(result.error);
      }
    });
  }

  /** Spread onto each row. The row must also render a visible grip so the
      affordance is discoverable — drag with no handle reads as broken. */
  function rowProps(index: number) {
    return {
      draggable: true,
      onDragStart: () => {
        dragSrcIndex.current = index;
      },
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setDrop(e.clientY < rect.top + rect.height / 2 ? index : index + 1);
      },
      onDrop: handleDrop,
      onDragEnd: reset,
    };
  }

  /** Spread onto the drop-lane element rendered at `dropIndex`. */
  const laneProps = {
    "aria-hidden": true,
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDrop: handleDrop,
  };

  return { dropIndex, rowProps, laneProps, isReordering: isPending };
}
