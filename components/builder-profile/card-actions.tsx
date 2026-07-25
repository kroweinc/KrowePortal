"use client";

import { useTransition } from "react";
import { Eye, EyeOff, GripVertical, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { setProfileItemHidden, type HideableKind } from "@/lib/actions/builder-profile";

// The trailing control cluster shared by every profile card — projects,
// experience, education, tools. Each card composes its own leading action
// (pencil for hand-authored rows, globe for a GitHub repo's demo link) via
// `children`; the eye and trash are identical everywhere, so they live here.

export function CardActionButton({
  label,
  onClick,
  danger,
  disabled,
  children,
}: {
  label: string;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`ss-cardact${danger ? " danger" : ""}`}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

export function CardActions({
  kind,
  id,
  hidden,
  name,
  onDelete,
  deleteLabel,
  children,
}: {
  kind: HideableKind;
  id: string;
  hidden: boolean;
  /** Used in the confirm copy and the icon labels, e.g. a project's name. */
  name: string;
  onDelete: () => Promise<{ error?: string } | void>;
  deleteLabel: string;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const [isPending, startTransition] = useTransition();

  function toggleHidden() {
    startTransition(async () => {
      const result = await setProfileItemHidden({ kind, id, hidden: !hidden });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(hidden ? `${name} is visible to clients.` : `${name} is hidden from clients.`);
      router.refresh();
    });
  }

  async function remove() {
    const ok = await confirm({
      title: deleteLabel,
      description: `${name} will be removed from your profile. This can't be undone.`,
      confirmText: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await onDelete();
      if (result && result.error) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <div className="ss-cardacts">
        {children}
        <CardActionButton
          label={hidden ? `Show ${name} on your public profile` : `Hide ${name} from clients`}
          onClick={toggleHidden}
          disabled={isPending}
        >
          {hidden ? <EyeOff /> : <Eye />}
        </CardActionButton>
        <CardActionButton label={deleteLabel} onClick={remove} disabled={isPending} danger>
          <Trash2 />
        </CardActionButton>
      </div>
      {confirmDialog}
    </>
  );
}

/** The drag affordance. Purely visual — the whole row carries the drag
    handlers from useDragReorder, so this must not steal the drag start. */
export function CardGrip() {
  return (
    <span className="ss-cardgrip" aria-hidden>
      <GripVertical />
    </span>
  );
}

/** Shown in place of a card while it's being dragged past. */
export function CardDropLane(props: Record<string, unknown>) {
  return <li className="ss-droplane" {...props} />;
}
