"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateProfile } from "@/lib/actions/profile";

interface ProfileEditorProps {
  initialName: string;
}

export function ProfileEditor({ initialName }: ProfileEditorProps) {
  const [name, setName] = useState(initialName);
  const [savedName, setSavedName] = useState(initialName);
  const [isPending, startTransition] = useTransition();

  const trimmed = name.trim();
  const dirty = trimmed !== savedName.trim();
  const canSave = dirty && trimmed.length > 0 && !isPending;

  function save() {
    if (!canSave) return;
    startTransition(async () => {
      const result = await updateProfile({ display_name: trimmed });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setSavedName(trimmed);
      setName(trimmed);
      toast.success("Saved");
    });
  }

  return (
    <div className="space-y-2">
      <label htmlFor="display_name" className="block text-xs font-medium text-neutral-700">
        Display name
      </label>
      <div className="flex items-center gap-2">
        <input
          id="display_name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          placeholder="Your name"
          className="flex-1 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400"
        />
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
