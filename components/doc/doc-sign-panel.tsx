"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";

type SignAction = (
  token: string,
  input: { signerName: string; consent: boolean }
) => Promise<{ success: true } | { error: string }>;

interface DocSignPanelProps {
  token: string;
  builderName: string;
  action: SignAction;
  heading: string;
  consentText: string;
  buttonLabel: string;
}

export function DocSignPanel({
  token,
  builderName,
  action,
  heading,
  consentText,
  buttonLabel,
}: DocSignPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);

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
      toast.success("Signed");
      router.refresh();
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
        {isPending ? "Signing…" : buttonLabel}
      </Button>

      <p className="mt-2 text-center text-xs text-neutral-400">
        Your typed name, the time, and your IP address are recorded as your electronic signature.
      </p>
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
