"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Sparkles, Wand2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { BUILDER_TAG_PRESETS } from "@/lib/types";
import { useProfileDraft } from "./profile-draft-context";

const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 40;

// Tags editor — bound to the shared draft. Changes autosave; the auto-derived
// badges come live from the draft context.
export function TagsEditor() {
  const { draft, autoTags, setTags } = useProfileDraft();
  const tags = draft.tags;
  const [input, setInput] = useState("");

  // Hide any auto tag the builder has since added by hand, so it doesn't appear
  // as both an editable chip and an auto chip.
  const manualKeys = new Set(tags.map((t) => t.toLowerCase()));
  const shownAutoTags = autoTags.filter((t) => !manualKeys.has(t.toLowerCase()));

  function addTag(raw: string) {
    const value = raw.trim();
    if (!value) return;
    if (value.length > MAX_TAG_LENGTH) {
      toast.error(`Each tag must be ${MAX_TAG_LENGTH} characters or fewer.`);
      return;
    }
    if (tags.some((t) => t.toLowerCase() === value.toLowerCase())) {
      setInput("");
      return;
    }
    if (tags.length >= MAX_TAGS) {
      toast.error(`You can add up to ${MAX_TAGS} tags.`);
      return;
    }
    setTags([...tags, value]);
    setInput("");
  }

  function removeTag(tag: string) {
    setTags(tags.filter((t) => t !== tag));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(input);
    }
  }

  // Don't suggest a preset that's already a manual chip or shown as an auto tag.
  const addedKeys = new Set([
    ...tags.map((t) => t.toLowerCase()),
    ...shownAutoTags.map((t) => t.toLowerCase()),
  ]);
  const availablePresets = BUILDER_TAG_PRESETS.filter((p) => !addedKeys.has(p.toLowerCase()));

  return (
    <div className="space-y-4">
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-700"
            >
              <Sparkles className="h-3 w-3" />
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="ml-0.5 rounded-full text-sky-500 hover:text-sky-800"
                aria-label={`Remove ${tag}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          maxLength={MAX_TAG_LENGTH}
          disabled={tags.length >= MAX_TAGS}
          placeholder="Type a tag and press Enter — e.g. 7x Years Developing"
        />
        <p className="text-[11px] text-neutral-400">
          Press Enter or comma to add. Up to {MAX_TAGS} tags.
        </p>
      </div>

      {shownAutoTags.length > 0 && tags.length < MAX_TAGS && (
        <div className="space-y-1.5 rounded-md border border-emerald-100 bg-emerald-50/50 p-2.5">
          <p className="flex items-center gap-1 text-[11px] font-medium text-emerald-700">
            <Wand2 className="h-3 w-3" /> Recommended from your profile
          </p>
          <div className="flex flex-wrap gap-1.5">
            {shownAutoTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => addTag(tag)}
                className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 hover:bg-emerald-200"
                aria-label={`Add ${tag}`}
              >
                <Plus className="h-3 w-3" />
                {tag}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-emerald-600/80">
            Suggested from your projects, experience, and tools. Click one to add it to
            your profile.
          </p>
        </div>
      )}

      {availablePresets.length > 0 && tags.length < MAX_TAGS && (
        <div className="flex flex-wrap gap-1.5">
          {availablePresets.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => addTag(preset)}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-neutral-300 px-2 py-0.5 text-xs text-neutral-500 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700"
            >
              + {preset}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
