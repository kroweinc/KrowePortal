"use client";

import { useState, useTransition, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

const FIELD_CLASS =
  "h-[46px] w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--background)] px-3.5 pr-11 text-[14.5px] text-[var(--foreground)] outline-none transition-[border-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-out-smooth)] placeholder:text-[var(--muted-foreground)] focus:border-[color-mix(in_oklch,var(--primary)_45%,var(--border))] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_22%,transparent)] disabled:cursor-not-allowed disabled:opacity-60";

const PRIMARY_BTN_CLASS =
  "flex h-[46px] w-full cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-full)] bg-[var(--primary)] text-[14.5px] font-semibold text-[var(--primary-foreground)] transition-[background-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-out-smooth)] hover:bg-[var(--primary-hover)] hover:shadow-[var(--shadow-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary)_35%,transparent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

const LABEL_CLASS = "mb-1.5 block text-[0.8rem] font-medium text-[var(--foreground)]";

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
      {off && (
        <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      )}
    </svg>
  );
}

export function ResetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    startTransition(async () => {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      // Recovery session is now a full session — land them in the app.
      window.location.assign("/");
    });
  }

  return (
    <div>
      <h1
        className="text-[clamp(1.6rem,4vw,1.85rem)] font-semibold tracking-tight"
        style={{ fontFamily: "var(--font-serif)", color: "var(--foreground)" }}
      >
        Set a new password
      </h1>
      <p className="mb-7 mt-2 text-[0.95rem]" style={{ color: "var(--muted-foreground)" }}>
        Choose a password you&apos;ll remember.
      </p>

      {error && (
        <div
          role="alert"
          className="mb-5 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]"
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="new-password" className={LABEL_CLASS}>
            New password
          </label>
          <div className="relative">
            <input
              id="new-password"
              name="new-password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              disabled={isPending}
              className={FIELD_CLASS}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-0 top-0 flex h-[46px] w-11 cursor-pointer items-center justify-center text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
            >
              <EyeIcon off={showPassword} />
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="confirm-password" className={LABEL_CLASS}>
            Confirm password
          </label>
          <input
            id="confirm-password"
            name="confirm-password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Re-enter your password"
            disabled={isPending}
            className={FIELD_CLASS}
          />
        </div>

        <button type="submit" disabled={isPending} className={PRIMARY_BTN_CLASS}>
          {isPending ? "Updating…" : "Update password"}
        </button>
      </form>
    </div>
  );
}
