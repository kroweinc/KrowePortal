# Auth emails via Resend (Supabase Custom SMTP)

All authentication emails — **signup confirmation, password reset, and email
change** — are delivered by **Resend**, configured as Supabase's **Custom SMTP**
provider. Supabase still owns the auth flow and generates the tokens/links; only
the mail **transport** is Resend.

> **No app code is involved.** The Next.js app never reads a Resend key. The
> existing flow (`supabase.auth.signUp` / `resetPasswordForEmail` → Supabase
> renders `{{ .ConfirmationURL }}` → `app/auth/callback/route.ts` runs
> `exchangeCodeForSession`) is transport-agnostic. Custom SMTP just hands the
> rendered email to Resend over SMTP. The `RESEND_API_KEY` lives **only** in the
> Supabase SMTP settings, not in `.env`.

## Why

Supabase's built-in email service is rate-limited (a few emails/hour), is meant
for testing only, and in production can silently drop mail or deliver only to
project members. Resend gives real deliverability with a verified sending domain
(SPF/DKIM/DMARC).

## Setup runbook

### 1. Resend — verify a sending domain
- Resend → **Domains → Add Domain** (e.g. a subdomain like `mail.<yourdomain>`).
- Add the **SPF (TXT/MX)**, **DKIM (TXT)**, and (recommended) **DMARC (TXT)**
  records Resend provides to your DNS host.
- Wait until the domain shows **Verified**. The Supabase "Sender email" must be
  an address on this domain (e.g. `noreply@mail.<yourdomain>`).

### 2. Resend — create an API key
- Resend → **API Keys → Create API Key** (Sending access).
- Copy the `re_...` key. It is the SMTP **password** in the next step.

### 3. Supabase — enable Custom SMTP
Dashboard → **Authentication → Emails → SMTP Settings** → enable **Custom SMTP**:

| Field         | Value                                         |
| ------------- | --------------------------------------------- |
| Sender email  | `noreply@<your-verified-resend-domain>`       |
| Sender name   | `Krowe`                                        |
| Host          | `smtp.resend.com`                             |
| Port          | `465` (SSL) — or `587` (STARTTLS)             |
| Username      | `resend`                                       |
| Password      | the Resend API key from step 2                 |

### 4. Supabase — raise the email rate limit
Dashboard → **Authentication → Rate Limits** → raise **"Rate limit for sending
emails"** above the tiny built-in default (match your Resend plan, e.g. 100+/hr).
With Custom SMTP enabled, the "team members only" restriction is lifted.

### 5. Supabase — confirm the redirect allow-list
Dashboard → **Authentication → URL Configuration**:
- **Site URL:** `https://krowe-portal.vercel.app`
- **Redirect URLs** must include:
  - `https://krowe-portal.vercel.app/**`
  - `http://localhost:3030/**`

The app's `emailRedirectTo` values must match an entry here, or Supabase falls
back to Site URL and confirmation links can break.

### 6. (optional) Brand the templates
Dashboard → **Authentication → Email Templates** — customize *Confirm signup*,
*Reset password*, *Magic Link*, *Change email*. Keep `{{ .ConfirmationURL }}`
intact so `app/auth/callback/route.ts` keeps working.

## Verify end-to-end

1. **Signup:** `/login` → signup with a fresh inbox. Email should arrive **from
   your Resend sender**. Resend → **Emails** shows **Delivered**. The link routes
   through `/auth/callback` and logs you in.
2. **Password reset:** `/login` → "Forgot password". Reset email arrives via
   Resend and the link lands on `/reset-password`.
3. **Auth headers:** In Gmail → "Show original", confirm `SPF=pass` and
   `DKIM=pass`.
4. **Negative check:** No mail still arrives from Supabase's default sender;
   Supabase Auth logs show SMTP sends without errors.

## Future option

For branded **React-Email templates owned in code**, switch to Supabase's *Send
Email Hook* (a webhook endpoint that renders templates and sends via the Resend
API). Custom SMTP keeps templates in the Supabase dashboard.
