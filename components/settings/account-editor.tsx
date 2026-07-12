"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { updateProfile } from "@/lib/actions/profile";
import { SettingsSection } from "@/components/settings/settings-section";
import type { Role } from "@/lib/types";

const inputClass = "krowe-set-input";
const btnClass = "krowe-set-btn-dark";

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
    <div className="krowe-set-stack">
      <SettingsSection title="Profile" hint="How you show up across the portal.">
        <div className="krowe-set-field">
          <label htmlFor="display_name" className="krowe-set-label">
            Display name
          </label>
          <div className="krowe-set-field-row">
            <input
              id="display_name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="Your name"
              className={inputClass}
            />
            <button type="button" onClick={saveName} disabled={!canSaveName} className={btnClass}>
              {namePending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
        <dl className="krowe-set-meta-grid">
          <div>
            <dt className="krowe-set-meta-k">Role</dt>
            <dd className="krowe-set-meta-v capitalize">{role}</dd>
          </div>
          <div>
            <dt className="krowe-set-meta-k">Member since</dt>
            <dd className="krowe-set-meta-v">{formatDate(memberSince)}</dd>
          </div>
        </dl>
      </SettingsSection>

      <SettingsSection title="Email" hint="The address you sign in with and where account emails are sent.">
        {isDevProfile ? (
          <p className="krowe-set-note">
            Email management isn’t available for the dev role. Sign in with a real account to change your email.
          </p>
        ) : (
          <div className="krowe-set-field">
            <label htmlFor="email" className="krowe-set-label">
              Email address
            </label>
            <div className="krowe-set-field-row">
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className={inputClass}
              />
              <button type="button" onClick={changeEmail} disabled={!canChangeEmail} className={btnClass}>
                {emailPending ? "Sending…" : "Change"}
              </button>
            </div>
            {pendingEmail ? (
              <p className="krowe-set-banner warn" style={{ fontSize: "12.5px", padding: "10px 14px" }}>
                Pending: check <span style={{ fontWeight: 600 }}>{pendingEmail}</span> and click the confirmation link to
                finish. Your sign-in email stays the same until you confirm.
              </p>
            ) : (
              <p className="krowe-set-note">
                We’ll email a confirmation link to the new address. Nothing changes until you click it.
              </p>
            )}
          </div>
        )}
      </SettingsSection>
    </div>
  );
}
