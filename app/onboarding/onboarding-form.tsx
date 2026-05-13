"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { completeOnboarding } from "@/lib/actions/profile";
import { cn } from "@/lib/utils";

type Role = "operator" | "builder";

export function OnboardingForm() {
  const [role, setRole] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    if (!role) {
      setError("Please select your role.");
      return;
    }
    formData.set("role", role);
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
      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-2">
          Your name
        </label>
        <Input name="display_name" placeholder="Jane Smith" required autoFocus />
      </div>

      <div>
        <label className="block text-xs font-medium text-neutral-700 mb-2">
          I am a…
        </label>
        <div className="grid grid-cols-2 gap-3">
          {(["operator", "builder"] as Role[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              className={cn(
                "rounded-lg border-2 p-4 text-left transition-colors",
                role === r
                  ? "border-neutral-900 bg-neutral-50"
                  : "border-neutral-200 hover:border-neutral-300"
              )}
            >
              <p className="text-sm font-semibold capitalize text-neutral-900">{r}</p>
              <p className="mt-1 text-xs text-neutral-500">
                {r === "operator"
                  ? "I run a business and need systems built."
                  : "I build internal systems for businesses."}
              </p>
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <Button type="submit" className="w-full" disabled={isPending || !role}>
        {isPending ? "Setting up…" : "Get started"}
      </Button>
    </form>
  );
}
