"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { completeOnboarding } from "@/lib/actions/profile";

export function OnboardingForm({ defaultName = "" }: { defaultName?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await completeOnboarding(formData);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <form
      action={handleSubmit}
      className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm space-y-5"
    >
      <input type="hidden" name="role" value="builder" />
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-2">
          Your name
        </label>
        <Input
          name="display_name"
          defaultValue={defaultName}
          placeholder="Jane Smith"
          required
          autoFocus
        />
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Setting up…" : "Get started"}
      </Button>
    </form>
  );
}
