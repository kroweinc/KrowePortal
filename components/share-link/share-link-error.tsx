import Link from "next/link";
import type { ShareLinkState } from "@/lib/actions/share-links";

// Single empty-state for every public share page (contract/quote/PRD/profile),
// replacing the four near-identical inline ErrorCards. The expired/revoked copy
// nudges the recipient to ask for a fresh link (mirrors the /join/[token] page)
// instead of a dead-end 404.
function messageFor(state: ShareLinkState, noun: string): { title: string; hint?: string } {
  switch (state) {
    case "expired":
    case "revoked":
      return {
        title: "This link is no longer active.",
        hint: "Ask your builder for a new link.",
      };
    case "unavailable":
      return { title: `This ${noun} isn't available.` };
    case "not-found":
    default:
      return { title: `This ${noun} link is invalid.` };
  }
}

export function ShareLinkError({ state, noun }: { state: ShareLinkState; noun: string }) {
  const { title, hint } = messageFor(state, noun);
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm text-center">
        <p className="text-sm text-neutral-500">{title}</p>
        {hint && <p className="mt-1 text-sm text-neutral-500">{hint}</p>}
        <Link href="/" className="mt-4 inline-block text-sm text-neutral-700 underline">
          Go home
        </Link>
      </div>
    </main>
  );
}
