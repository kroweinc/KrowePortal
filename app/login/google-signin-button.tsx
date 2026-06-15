"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";
import { createClient } from "@/lib/supabase/client";

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

// Minimal slice of the Google Identity Services (GIS) API we rely on.
// Loaded at runtime from https://accounts.google.com/gsi/client.
type GoogleCredentialResponse = { credential: string; select_by?: string };

type GoogleIdConfig = {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
  nonce?: string;
  use_fedcm_for_prompt?: boolean;
  auto_select?: boolean;
};

type GoogleButtonConfig = {
  type?: "standard" | "icon";
  theme?: "outline" | "filled_blue" | "filled_black";
  size?: "large" | "medium" | "small";
  text?: "signin_with" | "signup_with" | "continue_with" | "signin";
  shape?: "rectangular" | "pill" | "circle" | "square";
  logo_alignment?: "left" | "center";
  width?: number;
};

interface GoogleAccountsId {
  initialize: (config: GoogleIdConfig) => void;
  renderButton: (parent: HTMLElement, options: GoogleButtonConfig) => void;
  prompt: () => void;
  cancel: () => void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

/**
 * Generate a nonce pair for the Google ID-token flow.
 * Google embeds the *hashed* nonce in the issued ID token; Supabase re-hashes
 * the *raw* nonce we hand it and compares. So Google gets `hashed`, Supabase
 * gets `raw`. This binds the token to this sign-in attempt (anti-replay).
 */
async function makeNonce(): Promise<{ raw: string; hashed: string }> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const raw = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const hashed = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return { raw, hashed };
}

type Props = {
  /** Relative path to send the user to after a successful sign-in. */
  nextPath: string;
  /** Surface an error back to the parent login form. */
  onError: (message: string) => void;
};

/**
 * "Sign in with Google" using Google Identity Services directly, then exchanging
 * the resulting Google ID token with Supabase via signInWithIdToken().
 *
 * Because the OAuth handshake runs against our own authorized JS origin (not the
 * Supabase project URL), Google's account chooser shows "to continue to
 * krowehub.com" instead of "<ref>.supabase.co" — no redirect through Supabase.
 */
export function GoogleSignInButton({ nextPath, onError }: Props) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const rawNonceRef = useRef<string>("");
  const [scriptLoaded, setScriptLoaded] = useState(false);

  const handleCredential = useCallback(
    async (response: GoogleCredentialResponse) => {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithIdToken({
        provider: "google",
        token: response.credential,
        nonce: rawNonceRef.current,
      });
      if (error) {
        onError("Google sign-in failed. Please try again.");
        return;
      }
      // Hard navigation so the server picks up the freshly set session cookie
      // (mirrors the password sign-in path in login-form.tsx).
      window.location.assign(nextPath);
    },
    [nextPath, onError]
  );

  useEffect(() => {
    if (!scriptLoaded || !GOOGLE_CLIENT_ID) return;
    const gid = window.google?.accounts?.id;
    const parent = buttonRef.current;
    if (!gid || !parent) return;

    let cancelled = false;
    (async () => {
      const { raw, hashed } = await makeNonce();
      if (cancelled) return;
      rawNonceRef.current = raw;

      gid.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleCredential,
        nonce: hashed,
        use_fedcm_for_prompt: true,
      });
      gid.renderButton(parent, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "continue_with",
        shape: "pill",
        logo_alignment: "left",
        width: Math.min(parent.offsetWidth || 360, 400),
      });
      // One Tap prompt — bonus UX. Fails silently if unsupported/declined.
      gid.prompt();
    })();

    return () => {
      cancelled = true;
    };
  }, [scriptLoaded, handleCredential]);

  // Misconfiguration guard: without a client ID this component renders nothing,
  // so login-form falls back to the redirect-flow button instead.
  if (!GOOGLE_CLIENT_ID) return null;

  return (
    <>
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onLoad={() => setScriptLoaded(true)}
      />
      <div ref={buttonRef} className="flex h-[46px] w-full items-center justify-center" />
    </>
  );
}
