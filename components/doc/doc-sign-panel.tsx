"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PenLine, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";

type SignAction = (
  token: string,
  input: { signerName: string; consent: boolean }
) => Promise<{ success: true; redirectTo?: string } | { error: string }>;

type RejectAction = (
  token: string,
  note: string
) => Promise<{ success: true } | { error: string }>;

interface DocSignPanelProps {
  token: string;
  builderName: string;
  action: SignAction;
  heading: string;
  consentText: string;
  buttonLabel: string;
  /** Whether a viewer with an account is present. When false, the panel asks
   *  them to create an account before they can accept. */
  isAuthenticated: boolean;
  /** Pre-fills the signer name when the viewer is signed in. */
  viewerName?: string;
  /** Where to send a logged-out viewer to create an account (round-trips back
   *  to this document via the `next` param). */
  loginHref: string;
  /** When provided, surfaces a "Decline" affordance that flips the doc to
   *  rejected with an optional reason. */
  onReject?: RejectAction;
}

export function DocSignPanel({
  token,
  builderName,
  action,
  heading,
  consentText,
  buttonLabel,
  isAuthenticated,
  viewerName,
  loginHref,
  onReject,
}: DocSignPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(viewerName ?? "");
  const [consent, setConsent] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const [declined, setDeclined] = useState(false);

  // Logged out: gate acceptance behind account creation. The preview above is
  // fully readable; only accepting requires an account.
  if (!isAuthenticated) {
    return (
      <div className="mt-6 rounded-lg border border-neutral-200 bg-white p-6 text-center shadow-sm">
        <div className="mb-3 flex items-center justify-center gap-2">
          <UserPlus className="h-4 w-4 text-neutral-500" />
          <h2 className="text-sm font-semibold text-neutral-900">{heading}</h2>
        </div>
        <p className="mx-auto mb-4 max-w-sm text-sm text-neutral-600">
          Create a free account to accept and sign this document from{" "}
          <span className="font-medium text-neutral-900">{builderName}</span>. It only takes a moment
          and gives you a portal to track the work.
        </p>
        <Button onClick={() => router.push(loginHref)} className="w-full">
          Create an account to accept
        </Button>
      </div>
    );
  }

  if (declined) {
    return (
      <div className="mt-6 rounded-lg border border-neutral-200 bg-neutral-50 p-6 text-center shadow-sm">
        <h2 className="text-sm font-semibold text-neutral-900">You declined this document</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm text-neutral-600">
          We&apos;ve let <span className="font-medium text-neutral-900">{builderName}</span> know. You
          can close this page.
        </p>
      </div>
    );
  }

  function decline() {
    if (!onReject) return;
    startTransition(async () => {
      const result = await onReject(token, rejectNote);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Response sent");
      setDeclined(true);
    });
  }

  function sign() {
    if (name.trim().length < 2) {
      toast.error("Please type your full name to sign.");
      return;
    }
    if (!consent) {
      toast.error("Please agree to the terms to sign.");
      return;
    }
    startTransition(async () => {
      const result = await action(token, { signerName: name, consent });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Accepted");
      if (result.redirectTo) {
        router.push(result.redirectTo);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="mt-6 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <PenLine className="h-4 w-4 text-neutral-500" />
        <h2 className="text-sm font-semibold text-neutral-900">{heading}</h2>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-neutral-900">Full legal name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Type your name to sign"
          className="w-full rounded border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
        />
      </label>

      <label className="mt-3 flex items-start gap-2 text-sm text-neutral-700">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
        <span>
          {consentText}{" "}
          <span className="font-medium text-neutral-900">{builderName}</span>.
        </span>
      </label>

      <Button onClick={sign} disabled={isPending} className="mt-4 w-full">
        {isPending ? "Accepting…" : buttonLabel}
      </Button>

      <p className="mt-2 text-center text-xs text-neutral-400">
        Your name, account, the time, and your IP address are recorded as your electronic signature.
      </p>

      {onReject && !declining && (
        <button
          type="button"
          onClick={() => setDeclining(true)}
          disabled={isPending}
          className="mt-3 w-full text-center text-xs text-neutral-500 transition-colors hover:text-neutral-800 disabled:opacity-50"
        >
          Decline this document
        </button>
      )}

      {onReject && declining && (
        <div className="mt-4 border-t border-neutral-100 pt-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-neutral-900">
              Reason for declining <span className="font-normal text-neutral-400">(optional)</span>
            </span>
            <textarea
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="Let them know what needs to change"
              className="w-full rounded border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
            />
          </label>
          <div className="mt-3 flex gap-2">
            <Button variant="ghost" onClick={() => setDeclining(false)} disabled={isPending} className="flex-1">
              Cancel
            </Button>
            <Button variant="outline" onClick={decline} disabled={isPending} className="flex-1">
              {isPending ? "Sending…" : "Confirm decline"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function DocSignedBanner({
  message,
  signerName,
  signedAt,
}: {
  message: string;
  signerName?: string | null;
  signedAt?: string | null;
}) {
  return (
    <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-center">
      <p className="text-sm font-medium text-emerald-900">{message}</p>
      {signerName && signedAt && (
        <p className="mt-1 text-xs text-emerald-700">
          Signed by {signerName} on{" "}
          {new Date(signedAt).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </p>
      )}
    </div>
  );
}
