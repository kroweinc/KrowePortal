#!/usr/bin/env node
/**
 * Send a rendered auth-email template as a real test email via Resend.
 *
 * Why this exists: production auth mail is sent by Supabase (Custom SMTP → Resend),
 * so there's no app code path to preview a template. This script renders a template
 * file locally — substituting the Supabase Go-template vars with test values — and
 * sends it straight through the Resend API so you can eyeball it in a real inbox.
 *
 * Usage:
 *   node scripts/send-test-email.mjs [template] [recipient]
 *
 * Defaults:
 *   template  = confirm-signup
 *   recipient = marketingintern@patelgaines.com
 *
 * Reads RESEND_API_KEY from .env.local (no app env var needed).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// --- minimal .env.local reader (RESEND_API_KEY only) ---
function readEnvKey(key) {
  if (process.env[key]) return process.env[key];
  try {
    const env = readFileSync(join(root, ".env.local"), "utf8");
    const line = env.split("\n").find((l) => l.trim().startsWith(`${key}=`));
    if (!line) return undefined;
    return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
  } catch {
    return undefined;
  }
}

const TEMPLATES = {
  "confirm-signup": {
    file: "docs/email-templates/confirm-signup.html",
    subject: "Confirm your email — Krowe",
  },
};

const templateName = process.argv[2] || "confirm-signup";
const recipient = process.argv[3] || "marketingintern@patelgaines.com";
const FROM = "Krowe <noreply@krowehub.com>";

const tpl = TEMPLATES[templateName];
if (!tpl) {
  console.error(`Unknown template "${templateName}". Options: ${Object.keys(TEMPLATES).join(", ")}`);
  process.exit(1);
}

const apiKey = readEnvKey("RESEND_API_KEY");
if (!apiKey) {
  console.error("RESEND_API_KEY not found in environment or .env.local");
  process.exit(1);
}

// Render: replace Supabase template vars with realistic test values.
const testConfirmationURL =
  "https://krowehub.com/auth/callback?code=TEST-LINK-PREVIEW-ONLY&next=%2F";

let html = readFileSync(join(root, tpl.file), "utf8");
html = html
  .replaceAll("{{ .ConfirmationURL }}", testConfirmationURL)
  .replaceAll("{{ .SiteURL }}", "https://krowehub.com")
  .replaceAll("{{ .Email }}", recipient);

const res = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    from: FROM,
    to: [recipient],
    subject: tpl.subject,
    html,
  }),
});

const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`Send failed (${res.status}):`, body);
  process.exit(1);
}
console.log(`Sent "${templateName}" → ${recipient}`);
console.log(`From: ${FROM}`);
console.log(`Resend id: ${body.id ?? "(none returned)"}`);
