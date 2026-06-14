# Auth email templates (Krowe-branded)

Branded HTML for Supabase's auth emails. These are **dashboard-pasted** templates —
Supabase renders them and hands the result to Resend over Custom SMTP. See
[`../auth-email-resend-smtp.md`](../auth-email-resend-smtp.md) for the transport setup.

| File | Supabase template | Purpose |
| ---- | ----------------- | ------- |
| `confirm-signup.html` | **Confirm signup** | Email verification on new signup |

## Install into Supabase

1. Dashboard → **Authentication → Email Templates → Confirm signup**.
2. Paste the full contents of `confirm-signup.html` into the message body.
3. Subject line: `Confirm your email — Krowe`.
4. Save. Keep the `{{ .ConfirmationURL }}` token intact — `app/auth/callback/route.ts`
   depends on it.

## Design notes

- **Email-client safe:** table-based layout, inline styles, oklch colors converted
  to hex, a bulletproof (VML) CTA button for Outlook, hidden preheader text.
- **Brand:** primary `#f97316`, Instrument Serif headlines (Georgia fallback —
  custom web fonts only render in Apple/iOS Mail), warm neutral palette.
- **Logo** is loaded from the deployed app: `https://krowehub.com/images/KroweLogo.png`.

## Preview in a real inbox

```bash
node scripts/send-test-email.mjs confirm-signup you@example.com
```

Renders the template with a placeholder confirmation link and sends it via Resend
(from `noreply@krowehub.com`). Reads `RESEND_API_KEY` from `.env.local`.
The placeholder link is preview-only and does not verify anything.
