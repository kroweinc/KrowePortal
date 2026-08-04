"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptInvitation } from "@/lib/actions/invitations";

interface Props {
  token: string;
  suggestedName?: string;
}

// Matches the sign-in form's field and button treatment — this is the same
// public entry surface, one step further in. A text field takes the typing
// focus ring (1px --border-focus, no halo); the button takes the click halo.
const FIELD_CLASS =
  "h-[46px] w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--background)] px-3.5 text-[14.5px] text-[var(--foreground)] outline-none transition-[border-color] duration-[var(--duration-fast)] ease-[var(--ease-out-smooth)] placeholder:text-[var(--muted-foreground)] focus:border-[var(--border-focus)] disabled:cursor-not-allowed disabled:opacity-60";

const SUBMIT_CLASS =
  "flex h-[46px] w-full cursor-pointer items-center justify-center rounded-[var(--radius-full)] bg-[var(--primary)] text-[14.5px] font-semibold text-[var(--primary-foreground)] transition-[background-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-out-smooth)] hover:bg-[var(--primary-hover)] hover:shadow-[var(--shadow-1)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color-mix(in_srgb,var(--primary)_25%,transparent)] disabled:cursor-not-allowed disabled:opacity-60";

export function AcceptInvitationForm({ token, suggestedName = "" }: Props) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(suggestedName);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await acceptInvitation(token, displayName);
      if ("error" in result) {
        setError(result.error);
      } else {
        router.push("/o");
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4">
      <div>
        <label
          htmlFor="join-display-name"
          className="mb-1.5 block text-[0.8rem] font-medium text-[var(--foreground)]"
        >
          Your name
        </label>
        <input
          id="join-display-name"
          name="display_name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Jane Smith"
          required
          autoFocus
          maxLength={80}
          disabled={isPending}
          className={FIELD_CLASS}
        />
      </div>

      {error && (
        <p role="alert" className="text-[0.8rem]" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}

      <button type="submit" className={SUBMIT_CLASS} disabled={isPending}>
        {isPending ? "Joining…" : "Accept invite"}
      </button>
    </form>
  );
}
