"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { updateProfile } from "@/lib/actions/profile";
import { SettingsSection } from "@/components/settings/settings-section";
import type { Role } from "@/lib/types";

const inputClass =
  "rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400 disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-neutral-400";
const btnClass =
  "rounded-md bg-neutral-900 px-4 py-2 text-sm text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40";

interface AccountEditorProps {
  initialName: string;
  currentEmail: string;
  role: Role;
  memberSince: string;
  /** Dev role profiles have no real auth user, so email change is unavailable. */
  isDevProfile: boolean;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AccountEditor({ initialName, currentEmail, role, memberSince, isDevProfile }: AccountEditorProps) {
  // ── Display name ───────────────────────────────────────────────────────────
  const [name, setName] = useState(initialName);
  const [savedName, setSavedName] = useState(initialName);
  const [namePending, startNameSave] = useTransition();

  const trimmedName = name.trim();
  const nameDirty = trimmedName !== savedName.trim();
  const canSaveName = nameDirty && trimmedName.length > 0 && !namePending;

  function saveName() {
    if (!canSaveName) return;
    startNameSave(async () => {
      const result = await updateProfile({ display_name: trimmedName });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setSavedName(trimmedName);
      setName(trimmedName);
      toast.success("Saved");
    });
  }

  // ── Email change ───────────────────────────────────────────────────────────
  const [email, setEmail] = useState(currentEmail);
  const [emailPending, setEmailPending] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  const trimmedEmail = email.trim();
  const emailDirty = trimmedEmail.toLowerCase() !== currentEmail.toLowerCase();
  const canChangeEmail =
    emailDirty && EMAIL_RE.test(trimmedEmail) && !emailPending && !isDevProfile;

  async function changeEmail() {
    if (!canChangeEmail) return;
    setEmailPending(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ email: trimmedEmail });
      if (error) {
        toast.error(error.message);
        return;
      }
      setPendingEmail(trimmedEmail);
      toast.success(`Confirmation link sent to ${trimmedEmail}`);
    } finally {
      setEmailPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <SettingsSection title="Profile" hint="How you show up across the portal.">
        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="display_name" className="block text-xs font-medium text-neutral-700">
              Display name
            </label>
            <div className="flex items-center gap-2">
              <input
                id="display_name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                placeholder="Your name"
                className={inputClass + " flex-1"}
              />
              <button type="button" onClick={saveName} disabled={!canSaveName} className={btnClass}>
                {namePending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-3 border-t border-neutral-100 pt-3 text-sm">
            <div>
              <dt className="text-xs text-neutral-500">Role</dt>
              <dd className="capitalize text-neutral-900">{role}</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">Member since</dt>
              <dd className="text-neutral-900">{formatDate(memberSince)}</dd>
            </div>
          </dl>
        </div>
      </SettingsSection>

      <SettingsSection title="Email" hint="The address you sign in with and where account emails are sent.">
        {isDevProfile ? (
          <p className="text-sm text-neutral-500">
            Email management isn’t available for the dev role. Sign in with a real account to change your email.
          </p>
        ) : (
          <div className="space-y-2">
            <label htmlFor="email" className="block text-xs font-medium text-neutral-700">
              Email address
            </label>
            <div className="flex items-center gap-2">
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className={inputClass + " flex-1"}
              />
              <button type="button" onClick={changeEmail} disabled={!canChangeEmail} className={btnClass}>
                {emailPending ? "Sending…" : "Change"}
              </button>
            </div>
            {pendingEmail ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Pending: check <span className="font-medium">{pendingEmail}</span> and click the confirmation link to
                finish. Your sign-in email stays the same until you confirm.
              </p>
            ) : (
              <p className="text-xs text-neutral-500">
                We’ll email a confirmation link to the new address. Nothing changes until you click it.
              </p>
            )}
          </div>
        )}
      </SettingsSection>
    </div>
  );
}
