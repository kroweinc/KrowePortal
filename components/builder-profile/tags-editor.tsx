"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { BUILDER_TAG_PRESETS } from "@/lib/types";
import { useProfileDraft } from "./profile-draft-context";

const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 40;

// Tags editor — bound to the shared draft. Changes autosave; the recommended
// badges come live from the draft context (derived from the profile's own
// content, including anything a resume import filled in).
export function TagsEditor() {
  const { draft, autoTags, setTags } = useProfileDraft();
  const tags = draft.tags;
  const [input, setInput] = useState("");

  // Hide any recommendation the builder has since added by hand, so it doesn't
  // appear as both an editable chip and an offer.
  const manualKeys = new Set(tags.map((t) => t.toLowerCase()));
  const shownAutoTags = autoTags.filter((t) => !manualKeys.has(t.toLowerCase()));
  const atLimit = tags.length >= MAX_TAGS;

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
    if (atLimit) {
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

  // Don't offer a preset that's already a chip or already recommended.
  const addedKeys = new Set([
    ...tags.map((t) => t.toLowerCase()),
    ...shownAutoTags.map((t) => t.toLowerCase()),
  ]);
  const availablePresets = BUILDER_TAG_PRESETS.filter((p) => !addedKeys.has(p.toLowerCase()));

  return (
    <>
      {tags.length > 0 && (
        <div className="ss-chiprow">
          {tags.map((tag) => (
            <span key={tag} className="ss-chip on">
              {tag}
              <button type="button" onClick={() => removeTag(tag)} aria-label={`Remove ${tag}`}>
                <X />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="ss-field">
        <input
          className="ss-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          maxLength={MAX_TAG_LENGTH}
          disabled={atLimit}
          placeholder="e.g., 7+ Years Experience"
          aria-label="Add a tag"
        />
        <p className="ss-count">
          {tags.length}/{MAX_TAGS}
        </p>
      </div>

      {shownAutoTags.length > 0 && !atLimit && (
        <div className="ss-recommend">
          <p className="lab">Recommended from your resume</p>
          <div className="ss-chiprow">
            {shownAutoTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="ss-chip fromresume"
                onClick={() => addTag(tag)}
                aria-label={`Add ${tag}`}
              >
                <Plus />
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}

      {availablePresets.length > 0 && !atLimit && (
        <div className="ss-chiprow">
          {availablePresets.map((preset) => (
            <button
              key={preset}
              type="button"
              className="ss-chip suggest"
              onClick={() => addTag(preset)}
              aria-label={`Add ${preset}`}
            >
              <Plus />
              {preset}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
