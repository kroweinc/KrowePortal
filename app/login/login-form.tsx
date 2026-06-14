"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const ERROR_MESSAGES: Record<string, string> = {
  auth_failed: "Sign-in failed. Please try again.",
  github_denied: "GitHub authorization was cancelled or denied. Please try again.",
  github_token_failed: "Couldn't complete the GitHub handshake. Please try connecting again.",
  github_save_failed: "We couldn't save your GitHub connection. Please try again.",
};

type Mode = "signin" | "signup" | "forgot";

const COPY: Record<Mode, { title: string; subtitle: string; submit: string; pending: string }> = {
  signin: {
    title: "Sign in",
    subtitle: "Pick up right where you left off.",
    submit: "Sign in",
    pending: "Signing in…",
  },
  signup: {
    title: "Create your account",
    subtitle: "Set up your portal in a moment.",
    submit: "Create account",
    pending: "Creating account…",
  },
  forgot: {
    title: "Reset your password",
    subtitle: "We'll email you a link to set a new one.",
    submit: "Send reset link",
    pending: "Sending…",
  },
};

// Shared field + button styling, tuned to the login screen's token palette.
const FIELD_CLASS =
  "h-[46px] w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--background)] px-3.5 text-[14.5px] text-[var(--foreground)] outline-none transition-[border-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-out-smooth)] placeholder:text-[var(--muted-foreground)] focus:border-[color-mix(in_oklch,var(--primary)_45%,var(--border))] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_22%,transparent)] disabled:cursor-not-allowed disabled:opacity-60";

const PRIMARY_BTN_CLASS =
  "flex h-[46px] w-full cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-full)] bg-[var(--primary)] text-[14.5px] font-semibold text-[var(--primary-foreground)] transition-[background-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-out-smooth)] hover:bg-[var(--primary-hover)] hover:shadow-[var(--shadow-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary)_35%,transparent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

const LABEL_CLASS =
  "mb-1.5 block text-[0.8rem] font-medium text-[var(--foreground)]";

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
        fill="#4285F4"
      />
      <path
        d="M9.003 18c2.43 0 4.467-.806 5.956-2.18L12.05 13.56c-.806.54-1.836.86-3.047.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9.003 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.712c-.18-.54-.282-1.117-.282-1.71 0-.593.102-1.17.282-1.71V4.96H.957C.347 6.175 0 7.55 0 9.002c0 1.452.348 2.827.957 4.042l3.007-2.332z"
        fill="#FBBC05"
      />
      <path
        d="M9.003 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9.003 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29c.708-2.127 2.692-3.71 5.036-3.71z"
        fill="#EA4335"
      />
    </svg>
  );
}

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

export function LoginForm() {
  const searchParams = useSearchParams();
  const urlError = searchParams.get("error");
  const initialMode = searchParams.get("mode") === "signup" ? "signup" : "signin";

  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const copy = COPY[mode];
  const displayError =
    formError ??
    (urlError ? (ERROR_MESSAGES[urlError] ?? "Something went wrong. Please try again.") : null);

  function nextPath() {
    return searchParams.get("next") ?? "/portal";
  }

  function switchMode(next: Mode) {
    setMode(next);
    setFormError(null);
    setNotice(null);
  }

  function handleGoogleSignIn() {
    startTransition(async () => {
      const supabase = createClient();
      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(nextPath())}`,
          queryParams: { access_type: "offline", prompt: "consent" },
        },
      });
    });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setNotice(null);

    startTransition(async () => {
      const supabase = createClient();

      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${location.origin}/auth/callback?next=/reset-password`,
        });
        if (error) {
          setFormError(error.message);
          return;
        }
        setNotice("If an account exists for that email, a password reset link is on its way.");
        return;
      }

      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(nextPath())}`,
          },
        });
        if (error) {
          setFormError(error.message);
          return;
        }
        // Session present → email confirmation is disabled, so we're logged in.
        if (data.session) {
          window.location.assign(nextPath());
          return;
        }
        // Otherwise confirmation is required before the account is usable.
        setNotice("Almost there — check your email to confirm your account, then sign in.");
        return;
      }

      // signin
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setFormError(error.message);
        return;
      }
      // Hard navigation so the server picks up the freshly set session cookie.
      window.location.assign(nextPath());
    });
  }

  return (
    <div>
      <h1
        className="text-[clamp(1.75rem,4vw,2rem)] font-semibold tracking-tight"
        style={{ fontFamily: "var(--font-serif)", color: "var(--foreground)" }}
      >
        {copy.title}
      </h1>
      <div className="mb-4 mt-1.5 text-[0.95rem]" style={{ color: "var(--muted-foreground)" }}>
        {copy.subtitle}
      </div>

      {displayError && (
        <div
          role="alert"
          className="mb-5 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]"
        >
          {displayError}
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="mb-5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-subtle)] px-4 py-3 text-sm text-[var(--foreground)]"
        >
          {notice}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className={LABEL_CLASS}>
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            disabled={isPending}
            className={FIELD_CLASS}
          />
        </div>

        {mode !== "forgot" && (
          <div>
            <label htmlFor="password" className={LABEL_CLASS}>
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                required
                minLength={mode === "signup" ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "signup" ? "At least 8 characters" : "••••••••"}
                disabled={isPending}
                className={`${FIELD_CLASS} pr-11`}
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
            {mode === "signin" && (
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => switchMode("forgot")}
                  className="cursor-pointer text-[0.78rem] font-medium text-[var(--primary)] transition-opacity hover:opacity-80"
                >
                  Forgot password?
                </button>
              </div>
            )}
          </div>
        )}

        <button type="submit" disabled={isPending} className={PRIMARY_BTN_CLASS}>
          {isPending ? copy.pending : copy.submit}
        </button>
      </form>

      {mode !== "forgot" && (
        <>
          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-[var(--border)]" />
            <span className="text-xs text-[var(--muted-foreground)]">or</span>
            <span className="h-px flex-1 bg-[var(--border)]" />
          </div>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={isPending}
            className="flex h-[46px] w-full cursor-pointer items-center justify-center gap-3 whitespace-nowrap rounded-[var(--radius-full)] border border-[var(--border)] bg-[var(--background)] text-[14.5px] font-medium text-[var(--foreground)] transition-[border-color,box-shadow,background-color] duration-[var(--duration-fast)] ease-[var(--ease-out-smooth)] hover:border-[color-mix(in_oklch,var(--foreground)_22%,var(--border))] hover:bg-[var(--surface-subtle)] hover:shadow-[var(--shadow-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary)_35%,transparent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <GoogleIcon />
            Continue with Google
          </button>
        </>
      )}

      <div className="mt-4 text-center text-[0.85rem]" style={{ color: "var(--muted-foreground)" }}>
        {mode === "signin" && (
          <>
            Don&apos;t have an account?{" "}
            <button
              type="button"
              onClick={() => switchMode("signup")}
              className="cursor-pointer font-medium text-[var(--primary)] transition-opacity hover:opacity-80"
            >
              Create one
            </button>
          </>
        )}
        {mode === "signup" && (
          <>
            Already have an account?{" "}
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className="cursor-pointer font-medium text-[var(--primary)] transition-opacity hover:opacity-80"
            >
              Sign in
            </button>
          </>
        )}
        {mode === "forgot" && (
          <button
            type="button"
            onClick={() => switchMode("signin")}
            className="cursor-pointer font-medium text-[var(--primary)] transition-opacity hover:opacity-80"
          >
            ← Back to sign in
          </button>
        )}
      </div>
    </div>
  );
}
