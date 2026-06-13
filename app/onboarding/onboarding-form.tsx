"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { completeOnboarding } from "@/lib/actions/profile";
import { WzPrimary, WzLineField } from "./wizard-shell";

export function OnboardingForm({ defaultName = "" }: { defaultName?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await completeOnboarding(formData);
      if (result && "error" in result && result.error) {
        setError(result.error);
        return;
      }
      // Builder profile now exists in_progress — re-render at the path step.
      router.refresh();
    });
  }

  return (
    <form action={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 22, maxWidth: 380 }}>
      <input type="hidden" name="role" value="builder" />
      <WzLineField
        label="Your name"
        name="display_name"
        defaultValue={defaultName}
        placeholder="Jane Smith"
        required
        autoFocus
        maxLength={80}
      />
      {error && (
        <p style={{ margin: 0, fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--danger)" }}>{error}</p>
      )}
      <WzPrimary type="submit" disabled={isPending}>
        {isPending ? "Setting up…" : "Get started"}
      </WzPrimary>
    </form>
  );
}
