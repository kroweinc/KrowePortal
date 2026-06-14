import "server-only";
import { sendEmail } from "@/lib/email/resend";
import type { FeedbackCategory, Role } from "@/lib/types";

// Where new-feedback notifications land. Defaults to the Krowe team inbox; override
// per-environment via FEEDBACK_NOTIFICATION_EMAIL (comma-separated for multiple).
const TEAM_EMAIL = process.env.FEEDBACK_NOTIFICATION_EMAIL || "kroweinc@gmail.com";

const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug: "Bug",
  idea: "Idea",
  other: "Other",
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export interface FeedbackNotification {
  submitterName: string;
  role: Role;
  category: FeedbackCategory;
  rating: number | null;
  message: string;
  pagePath: string | null;
}

/**
 * Email the Krowe team a formatted summary of a new product-feedback submission.
 * Best-effort: returns sendEmail's result and never throws (see lib/email/resend.ts).
 */
export async function sendFeedbackNotification(
  feedback: FeedbackNotification
): Promise<{ ok: boolean; error?: string }> {
  const categoryLabel = CATEGORY_LABELS[feedback.category];
  const stars = feedback.rating
    ? "★".repeat(feedback.rating) + "☆".repeat(5 - feedback.rating)
    : "—";
  const recipients = TEAM_EMAIL.split(",").map((e) => e.trim()).filter(Boolean);

  const subject = `New ${categoryLabel} feedback${
    feedback.rating ? ` (${feedback.rating}/5)` : ""
  } — ${feedback.submitterName}`;

  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 0;color:#78716c;width:90px;vertical-align:top;">${label}</td><td style="padding:6px 0;color:#1c1917;">${value}</td></tr>`;

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1c1917;">
    <div style="border-bottom:3px solid #f97316;padding-bottom:12px;margin-bottom:20px;">
      <h1 style="font-size:18px;margin:0;font-weight:600;">New product feedback</h1>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      ${row("From", `${escapeHtml(feedback.submitterName)} <span style="color:#78716c;">(${feedback.role})</span>`)}
      ${row("Type", categoryLabel)}
      ${row("Rating", `<span style="color:#f97316;font-size:16px;letter-spacing:1px;">${stars}</span>`)}
      ${feedback.pagePath ? row("Page", `<span style="font-family:ui-monospace,monospace;font-size:13px;">${escapeHtml(feedback.pagePath)}</span>`) : ""}
    </table>
    <div style="margin-top:18px;padding:16px;background:#fafaf9;border:1px solid #e7e5e4;border-radius:10px;white-space:pre-wrap;font-size:14px;line-height:1.55;">${escapeHtml(feedback.message)}</div>
    <p style="margin-top:24px;font-size:12px;color:#a8a29e;">Sent automatically by Krowe Portal.</p>
  </div>`;

  return sendEmail({ to: recipients, subject, html });
}
