import "server-only";
import { sendEmail } from "@/lib/email/resend";
import { createAdminClient } from "@/lib/supabase/server";
import { getPublicAppOrigin } from "@/lib/app-origin";

/**
 * User-facing transactional notifications.
 *
 * Each notify type maps to a boolean column on notification_preferences. The
 * dispatcher resolves the *recipient* (who is never the actor — an operator
 * signs, the builder is notified), so it must use the service-role admin
 * client: (a) to read another user's preference row, and (b) to look up their
 * email via auth.admin.getUserById. The recipient id always comes from a
 * server-verified relationship (project owner / engagement builder).
 *
 * Best-effort, exactly like lib/email/feedback-notification.ts: never throws,
 * so a notification failure can't break the primary action that fired it. In
 * dev (no RESEND_API_KEY) sendEmail is a silent no-op.
 */

export type NotifyType = "doc_signed" | "change_order" | "invite_accepted";

const PREF_COLUMN: Record<NotifyType, string> = {
  doc_signed: "notify_doc_signed",
  change_order: "notify_change_order",
  invite_accepted: "notify_invite_accepted",
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Shared Krowe-branded shell so every notification reads consistently. The
    optional CTA links back into the app (relative path resolved to the public
    origin). */
function renderEmail(opts: { heading: string; body: string; ctaLabel?: string; ctaPath?: string }): string {
  const origin = getPublicAppOrigin();
  const cta =
    opts.ctaLabel && opts.ctaPath
      ? `<div style="margin-top:24px;"><a href="${origin}${opts.ctaPath}" style="display:inline-block;background:#f97316;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:10px;">${escapeHtml(opts.ctaLabel)}</a></div>`
      : "";
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1c1917;">
    <div style="border-bottom:3px solid #f97316;padding-bottom:12px;margin-bottom:20px;">
      <h1 style="font-size:18px;margin:0;font-weight:600;">${escapeHtml(opts.heading)}</h1>
    </div>
    <div style="font-size:14px;line-height:1.6;">${opts.body}</div>
    ${cta}
    <p style="margin-top:28px;font-size:12px;color:#a8a29e;">Sent by Krowe Portal. Manage which emails you get in Settings → Notifications.</p>
  </div>`;
}

/**
 * Send a transactional email to a user IF their preference for this type is on.
 * Returns { ok } and never throws — call fire-and-forget with `void`.
 */
export async function notifyUser(opts: {
  userId: string;
  type: NotifyType;
  subject: string;
  html: string;
}): Promise<{ ok: boolean }> {
  try {
    const admin = createAdminClient();

    const column = PREF_COLUMN[opts.type];
    const { data: pref } = await admin
      .from("notification_preferences")
      .select(column)
      .eq("user_id", opts.userId)
      .maybeSingle();

    // Default-on: a missing row (the common case) means the user hasn't opted
    // out, so we send. Only an explicit `false` suppresses. The dynamic column
    // select leaves Supabase unable to infer the row shape, hence the cast.
    const row = pref as unknown as Record<string, boolean> | null;
    if (row && row[column] === false) {
      return { ok: false };
    }

    const { data } = await admin.auth.admin.getUserById(opts.userId);
    const to = data?.user?.email;
    if (!to) return { ok: false }; // dev profiles / deleted users have no email

    return sendEmail({ to, subject: opts.subject, html: opts.html });
  } catch {
    return { ok: false };
  }
}

// ── Type-specific builders ───────────────────────────────────────────────────
// Each returns { subject, html } so call sites stay a one-liner.

const DOC_LABELS = { quote: "quote", contract: "contract", prd: "PRD" } as const;
type DocKind = keyof typeof DOC_LABELS;

export function docSignedEmail(opts: {
  docKind: DocKind;
  signerName: string;
  projectName: string | null;
  projectId: string;
}): { subject: string; html: string } {
  const label = DOC_LABELS[opts.docKind];
  const where = opts.projectName ? ` for ${escapeHtml(opts.projectName)}` : "";
  return {
    subject: `Your ${label} was signed${opts.projectName ? ` — ${opts.projectName}` : ""}`,
    html: renderEmail({
      heading: `${label[0].toUpperCase()}${label.slice(1)} signed`,
      body: `<p><strong>${escapeHtml(opts.signerName)}</strong> signed your ${label}${where}. The engagement is moving forward.</p>`,
      ctaLabel: "Open document",
      ctaPath: `/b/projects/${opts.projectId}`,
    }),
  };
}

export function changeOrderSignedEmail(opts: {
  title: string;
  signerName: string;
  engagementId: string;
}): { subject: string; html: string } {
  return {
    subject: `Change order signed — ${opts.title}`,
    html: renderEmail({
      heading: "Change order signed",
      body: `<p><strong>${escapeHtml(opts.signerName)}</strong> signed the change order “${escapeHtml(opts.title)}”. Its milestone and tasks have been added to the engagement.</p>`,
      ctaLabel: "View engagement",
      ctaPath: `/b/engagements/${opts.engagementId}`,
    }),
  };
}

export function inviteAcceptedEmail(opts: {
  operatorName: string;
  engagementTitle: string;
  engagementId: string;
}): { subject: string; html: string } {
  return {
    subject: `${opts.operatorName} joined ${opts.engagementTitle}`,
    html: renderEmail({
      heading: "Operator joined your client",
      body: `<p><strong>${escapeHtml(opts.operatorName)}</strong> accepted your invite and now has access to <strong>${escapeHtml(opts.engagementTitle)}</strong>.</p>`,
      ctaLabel: "Open client",
      ctaPath: `/b/engagements/${opts.engagementId}`,
    }),
  };
}
