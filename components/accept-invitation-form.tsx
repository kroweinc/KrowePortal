"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { acceptInvitation } from "@/lib/actions/invitations";

interface Props {
  token: string;
  suggestedName?: string;
  skipNameField?: boolean;
}

export function AcceptInvitationForm({ token, suggestedName = "", skipNameField = false }: Props) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(suggestedName);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await acceptInvitation(token, skipNameField ? undefined : displayName);
      if ("error" in result) {
        setError(result.error);
      } else {
        router.push("/o");
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {!skipNameField && (
        <div>
          <label className="block text-xs font-medium text-neutral-700 mb-2">
            Your name
          </label>
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Jane Smith"
            required
            autoFocus
          />
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Joining…" : "Accept invite"}
      </Button>
    </form>
  );
}
