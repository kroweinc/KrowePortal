"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { SettingsSection } from "@/components/settings/settings-section";

const inputClass = "krowe-set-input mid";
const btnClass = "krowe-set-btn-dark";

interface SecurityEditorProps {
  currentEmail: string;
  /** True when the account has an email/password identity (so we can verify the
      current password). OAuth-only users have no password to verify. */
  isPasswordUser: boolean;
  /** Dev role profiles have no real auth user — password/session actions are off. */
  isDevProfile: boolean;
}

export function SecurityEditor({ currentEmail, isPasswordUser, isDevProfile }: SecurityEditorProps) {
  const [confirm, confirmDialog] = useConfirm();
  const logoutFormRef = useRef<HTMLFormElement>(null);

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [show, setShow] = useState(false);
  const [pending, setPending] = useState(false);

  const canSubmit =
    newPw.length >= 8 &&
    newPw === confirmPw &&
    (!isPasswordUser || currentPw.length > 0) &&
    !pending &&
    !isDevProfile;

  async function changePassword() {
    if (newPw.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (newPw !== confirmPw) {
      toast.error("Passwords don’t match.");
      return;
    }
    setPending(true);
    try {
      const supabase = createClient();
      // Best-effort current-password check for password accounts. Supabase
      // updateUser doesn't verify the old password, so we probe with a sign-in.
      if (isPasswordUser && currentPw) {
        const { error: reauthErr } = await supabase.auth.signInWithPassword({
          email: currentEmail,
          password: currentPw,
        });
        if (reauthErr) {
          toast.error("Current password is incorrect.");
          return;
        }
      }
      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) {
        toast.error(error.message);
        return;
      }
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      toast.success("Password updated");
    } finally {
      setPending(false);
    }
  }

  async function signOutEverywhere() {
    const ok = await confirm({
      title: "Sign out of all sessions?",
      description:
        "You’ll be signed out on every device, including this one. You’ll need to sign in again.",
      confirmText: "Sign out everywhere",
      tone: "danger",
      icon: LogOut,
    });
    if (!ok) return;
    try {
      const supabase = createClient();
      // Revoke every refresh token server-side…
      await supabase.auth.signOut({ scope: "global" });
    } catch {
      // ignore — the form submit below still clears the local session + cookies
    }
    // …then hand off to the server logout route to clear SSR cookies + redirect.
    logoutFormRef.current?.submit();
  }

  return (
    <div className="krowe-set-stack">
      <SettingsSection title="Password" hint="Choose a strong password you don’t use elsewhere.">
        {isDevProfile ? (
          <p className="krowe-set-note">
            Password management isn’t available for the dev role. Sign in with a real account to change your password.
          </p>
        ) : (
          <div>
            {isPasswordUser && (
              <div className="krowe-set-field">
                <label htmlFor="current_pw" className="krowe-set-label">
                  Current password
                </label>
                <input
                  id="current_pw"
                  type={show ? "text" : "password"}
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  autoComplete="current-password"
                  className={inputClass}
                />
              </div>
            )}
            <div className="krowe-set-field">
              <label htmlFor="new_pw" className="krowe-set-label">
                New password
              </label>
              <input
                id="new_pw"
                type={show ? "text" : "password"}
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder="At least 8 characters"
                autoComplete="new-password"
                minLength={8}
                className={inputClass}
              />
            </div>
            <div className="krowe-set-field">
              <label htmlFor="confirm_pw" className="krowe-set-label">
                Confirm new password
              </label>
              <input
                id="confirm_pw"
                type={show ? "text" : "password"}
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                placeholder="Re-enter your password"
                autoComplete="new-password"
                minLength={8}
                className={inputClass}
              />
            </div>
            <label className="krowe-set-check-row" style={{ marginTop: "12px" }}>
              <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
              Show passwords
            </label>
            {!isPasswordUser && (
              <p className="krowe-set-note" style={{ marginTop: "8px" }}>
                You signed up with Google. Setting a password here lets you also sign in with email.
              </p>
            )}
            <div style={{ marginTop: "16px" }}>
              <button type="button" onClick={changePassword} disabled={!canSubmit} className={btnClass}>
                {pending ? "Updating…" : "Update password"}
              </button>
            </div>
          </div>
        )}
      </SettingsSection>

      <SettingsSection title="Sessions" hint="Sign out everywhere if you’ve lost a device or shared your screen.">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="krowe-set-note" style={{ fontSize: "13px" }}>
            This signs you out on all devices, including this one.
          </p>
          <button
            type="button"
            onClick={signOutEverywhere}
            disabled={isDevProfile}
            className="krowe-set-btn-danger-outline"
          >
            <LogOut size={15} strokeWidth={1.9} />
            Sign out everywhere
          </button>
        </div>
        {isDevProfile && (
          <p className="krowe-set-note" style={{ marginTop: "8px" }}>Unavailable for the dev role.</p>
        )}
      </SettingsSection>

      {/* Hidden handoff: clears SSR httpOnly cookies + redirects to /login. */}
      <form ref={logoutFormRef} action="/api/auth/logout" method="POST" className="hidden" />
      {confirmDialog}
    </div>
  );
}
