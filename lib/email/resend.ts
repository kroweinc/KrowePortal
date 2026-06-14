import "server-only";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

// Verified Resend sending domain (same as scripts/send-test-email.mjs).
const DEFAULT_FROM = "Krowe <noreply@krowehub.com>";

interface SendEmailParams {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
  from?: string;
}

/**
 * Send a transactional email via the Resend REST API.
 *
 * Returns a result object rather than throwing so callers firing notifications
 * after a primary action (e.g. saving feedback) can never let an email failure
 * break that action. Requires RESEND_API_KEY in the app environment — if it's
 * missing the send is skipped (not an error), which is the expected dev default.
 */
export async function sendEmail({
  to,
  subject,
  html,
  replyTo,
  from = DEFAULT_FROM,
}: SendEmailParams): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[email] RESEND_API_KEY not set — skipping email send.");
    return { ok: false, error: "RESEND_API_KEY not set" };
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const error = `Resend ${res.status}: ${JSON.stringify(body)}`;
      console.error("[email] send failed —", error);
      return { ok: false, error };
    }
    return { ok: true };
  } catch (err) {
    console.error("[email] send threw —", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
