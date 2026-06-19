#!/usr/bin/env node
/**
 * Seed a self-contained DEMO / INVESTOR account against the hosted Supabase project.
 *
 * Creates (idempotent — safe to re-run):
 *   1. A verified builder login        → investinkrowe@krowehub.com / 500kPlease@
 *      (email_confirm:true, so the unverifiable krowehub.com domain is bypassed)
 *   2. A companion operator ("client") → krowe.internal@krowehub.com / 500kPlease@
 *      This is scaffolding so the builder's board shows a real client name and
 *      operator-requested tasks have proper attribution. It also lets you demo
 *      the *operator* side of the same engagement if you want.
 *   3. Sample data hung off the builder — themed as Krowe dogfooding Krowe:
 *        - 1 project ("Krowe Internal", Documents tab)
 *        - 1 live engagement linking builder ↔ operator
 *        - 7 tasks spread across inbox / in_progress / blocked / done
 *
 * Uses the service-role key (bypasses RLS). Reads creds from .env.local.
 *
 * Usage:  node scripts/seed-demo-account.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function env(key) {
  if (process.env[key]) return process.env[key];
  const line = readFileSync(join(root, ".env.local"), "utf8")
    .split("\n")
    .find((l) => l.trim().startsWith(`${key}=`));
  return line ? line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") : undefined;
}

const url = env("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

// ---- config -----------------------------------------------------------------
const BUILDER = { email: "investinkrowe@krowehub.com", password: "500kPlease@", name: "Krowe Demo" };
const OPERATOR = { email: "krowe.internal@krowehub.com", password: "500kPlease@", name: "Krowe Team" };
const ENGAGEMENT_TITLE = "Krowe Internal";
const PROJECT_NAME = "Krowe Internal";
// Demo operator emails from earlier runs that this theme supersedes — removed on run.
const LEGACY_OPERATOR_EMAILS = ["northwind.client@krowehub.com"];

// ---- helpers ----------------------------------------------------------------
async function findUserByEmail(email) {
  const target = email.toLowerCase();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === target);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
}

// Create the auth user (or update password + force-confirm if it already exists).
async function ensureUser({ email, password, name }) {
  const existing = await findUserByEmail(email);
  if (existing) {
    const { data, error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: { ...existing.user_metadata, full_name: name },
    });
    if (error) throw new Error(`updateUser ${email}: ${error.message}`);
    console.log(`  ↻ updated auth user ${email} (${data.user.id})`);
    return data.user.id;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // domain is fake → verify it ourselves
    user_metadata: { full_name: name },
  });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  console.log(`  ✓ created auth user ${email} (${data.user.id})`);
  return data.user.id;
}

async function ensureProfile(id, role, display_name) {
  const { error } = await admin.from("profiles").upsert(
    {
      id,
      role,
      display_name,
      onboarding_status: "completed", // skip the onboarding wizard
      onboarding: {},
      tour_status: "completed", // don't auto-pop the product tour mid-demo
    },
    { onConflict: "id" }
  );
  if (error) throw new Error(`profile ${display_name}: ${error.message}`);
  console.log(`  ✓ profile ${role} "${display_name}"`);
}

// ---- 0: retire superseded demo identities -----------------------------------
console.log("Cleanup:");
for (const email of LEGACY_OPERATOR_EMAILS) {
  const u = await findUserByEmail(email);
  if (u) {
    // profiles.id → auth.users ON DELETE CASCADE, and engagements.operator_id →
    // profiles ON DELETE CASCADE, so this also clears the old engagement + tasks.
    const { error } = await admin.auth.admin.deleteUser(u.id);
    if (error) throw new Error(`deleteUser ${email}: ${error.message}`);
    console.log(`  ✗ removed legacy operator ${email}`);
  }
}

// ---- 1 & 2: accounts + profiles --------------------------------------------
console.log("\nAccounts:");
const builderId = await ensureUser(BUILDER);
const operatorId = await ensureUser(OPERATOR);
await ensureProfile(builderId, "builder", BUILDER.name);
await ensureProfile(operatorId, "operator", OPERATOR.name);

// ---- reset any prior demo data for this builder (idempotency) ---------------
console.log("\nResetting prior demo data for this builder…");
const { data: priorEng } = await admin.from("engagements").select("id").eq("builder_id", builderId);
const priorIds = (priorEng ?? []).map((e) => e.id);
if (priorIds.length) {
  await admin.from("tasks").delete().in("engagement_id", priorIds);
  await admin.from("invitations").delete().in("engagement_id", priorIds);
  await admin.from("engagements").delete().in("id", priorIds);
  console.log(`  ✓ cleared ${priorIds.length} engagement(s) + their tasks`);
}
await admin.from("projects").delete().eq("owner_id", builderId);

// ---- 3: project (Documents tab) --------------------------------------------
console.log("\nSample data:");
const { data: project, error: projErr } = await admin
  .from("projects")
  .insert({
    owner_id: builderId,
    name: PROJECT_NAME,
    status: "active",
    prospect_name: "Krowe",
    prospect_email: "team@krowehub.com",
    website_url: "https://krowehub.com",
    context:
      "Internal build-out of the Krowe platform itself — the operator/builder portal, " +
      "the onboarding flow, billing, and the investor-facing surfaces. Dogfooding Krowe " +
      "to build Krowe.",
  })
  .select()
  .single();
if (projErr) throw new Error(`project: ${projErr.message}`);
console.log(`  ✓ project "${project.name}"`);

// ---- engagement (links builder ↔ operator, live) ---------------------------
const nowIso = new Date().toISOString();
const { data: engagement, error: engErr } = await admin
  .from("engagements")
  .insert({
    builder_id: builderId,
    operator_id: operatorId,
    title: ENGAGEMENT_TITLE,
    started_at: nowIso,
    project_id: project.id,
  })
  .select()
  .single();
if (engErr) throw new Error(`engagement: ${engErr.message}`);
console.log(`  ✓ engagement "${engagement.title}" (live)`);

// ---- tasks (spread across the build board) ---------------------------------
const eid = engagement.id;
const tasks = [
  {
    title: "Investor data room needs a clean public link",
    description:
      "We're sending the deck and metrics over email attachments. Want one branded, access-controlled link we can hand to investors instead.",
    source: "operator_request", status: "inbox", priority: "high", created_by: operatorId, sort_order: 0,
  },
  {
    title: "Signup drop-off spikes at the skills step",
    description:
      "Analytics show ~40% of operators abandon on the skills-selection screen. Need to figure out whether it's length, copy, or load time.",
    source: "operator_request", status: "inbox", priority: "medium", created_by: operatorId, sort_order: 1,
  },
  {
    title: "Build the operator analytics dashboard",
    description:
      "Operators want to see engagement activity, task throughput, and spend in one place instead of asking us for screenshots.",
    source: "operator_request", status: "in_progress", priority: "urgent", created_by: operatorId,
    builder_estimate_low_hours: 8, builder_estimate_high_hours: 14, sort_order: 0,
  },
  {
    title: "Wire signup metrics to the live events table",
    description: "Replace the hard-coded funnel numbers on the internal dashboard with live queries against the events table.",
    source: "builder_added", status: "in_progress", priority: "medium", created_by: builderId,
    builder_estimate_hours: 4, sort_order: 1,
  },
  {
    title: "Stripe billing — waiting on production keys",
    description: "Blocked: subscription + metered billing is built against test keys; need the production Stripe account approved before go-live.",
    source: "builder_added", status: "blocked", priority: "high", created_by: builderId, sort_order: 0,
  },
  {
    title: "Set up Supabase schema + RLS for the portal",
    description: "Profiles, engagements, tasks, and projects tables with row-level security and per-account isolation.",
    source: "builder_added", status: "done", priority: "high", created_by: builderId,
    pushed_to_main: true, completion_note: "Schema live with RLS; verified isolation across accounts.",
    completed_at: nowIso, sort_order: 0,
  },
  {
    title: "Replace the waitlist spreadsheet with the real signup flow",
    description: "Stand up the multi-step signup so new operators self-serve instead of landing in a Google Sheet.",
    source: "operator_request", status: "done", priority: "medium", created_by: operatorId,
    completion_note: "Signup flow shipped; waitlist sheet archived read-only.", completed_at: nowIso, sort_order: 1,
  },
].map((t) => ({ engagement_id: eid, pushed_to_main: false, ...t }));

const { data: insertedTasks, error: taskErr } = await admin.from("tasks").insert(tasks).select("id, status");
if (taskErr) throw new Error(`tasks: ${taskErr.message}`);
const byStatus = insertedTasks.reduce((a, t) => ((a[t.status] = (a[t.status] || 0) + 1), a), {});
console.log(`  ✓ ${insertedTasks.length} tasks (${Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(", ")})`);

// ============================================================================
// 4: rich document/profile data — so EVERY screen shows real, coherent content
//    instead of empty states. One "Krowe Internal" story across the portal:
//      • a published builder profile (bio, skills, links, experience, pricing)
//      • a signed PRD, an accepted Quote, and a sent (awaiting-signature) Contract
//      • a pasted discovery-call transcript (SOP)
//    Project docs cascade-delete with the project (recreated above), so this is
//    idempotent; profile children are explicitly cleared before re-insert.
// ============================================================================
const sentAtIso = new Date(Date.now() - 6 * 86400000).toISOString(); // ~6 days ago
const signedAtIso = new Date(Date.now() - 2 * 86400000).toISOString(); // ~2 days ago
const SIGNER_IP = "203.0.113.42"; // TEST-NET-3 placeholder
const OPERATOR_SIGNER = OPERATOR.name; // "Krowe Team" — the client who signed

console.log("\nBuilder profile:");
const { data: profile, error: profErr } = await admin
  .from("builder_profiles")
  .upsert(
    {
      user_id: builderId,
      display_name: BUILDER.name,
      headline: "AI-native product engineer — full-stack MVPs, shipped in weeks",
      bio:
        "I build production web apps end-to-end. The last year I've been heads-down on Krowe — " +
        "the operator–builder portal you're looking at — taking it from an empty repo to a live " +
        "platform with auth, an AI document pipeline, and billing. I work solo with Claude Code and " +
        "ship fast without cutting corners.",
      linkedin_url: "https://www.linkedin.com/in/krowe-demo",
      github_url: "https://github.com/krowehub",
      portfolio_url: "https://krowehub.com",
      education_school: "University of Texas at Austin",
      education_major: "Computer Science",
      education_year: "Class of 2021",
      tags: ["Technical Co-Founder", "Full-Stack Developer", "AI / ML Engineer", "Shipped a Product"],
      is_published: true,
      default_hourly_rate: 95,
      payment_terms_preset: "50_25_25",
      design_system_mode: "included",
      design_fixed_cost: 0,
    },
    { onConflict: "user_id" }
  )
  .select("id, token")
  .single();
if (profErr) throw new Error(`builder_profile: ${profErr.message}`);
const profileId = profile.id;
console.log(`  ✓ builder profile published (token ${profile.token.slice(0, 8)}…)`);

// Clear + reseed profile children (the profile row itself persists across runs).
await admin.from("builder_profile_experience").delete().eq("builder_profile_id", profileId);
await admin.from("builder_profile_coding_tools").delete().eq("builder_profile_id", profileId);
await admin.from("builder_profile_projects").delete().eq("builder_profile_id", profileId);

const experience = [
  {
    role: "Founder & Lead Engineer",
    company: "Krowe",
    company_domain: "krowehub.com",
    start_label: "2025",
    end_label: null,
    description:
      "Building the operator–builder portal end-to-end — Next.js, Supabase, and an AI document pipeline that turns a discovery call into a signed PRD, quote, and contract.",
    display_order: 0,
  },
  {
    role: "Senior Full-Stack Engineer",
    company: "Freelance",
    company_domain: null,
    start_label: "2021",
    end_label: "2025",
    description: "Shipped SaaS and e-commerce MVPs for early-stage startups, solo and as a tech lead.",
    display_order: 1,
  },
  {
    role: "Software Engineer",
    company: "Patel Gaines",
    company_domain: "patelgaines.com",
    start_label: "2019",
    end_label: "2021",
    description: "Internal tooling and client-facing web apps on a small product team.",
    display_order: 2,
  },
].map((e) => ({ builder_profile_id: profileId, ...e }));
await admin.from("builder_profile_experience").insert(experience);

const codingTools = [
  { name: "Claude Code", category: "AI Assistant", url: "https://claude.com/claude-code" },
  { name: "GitHub Copilot", category: "AI Assistant", url: "https://github.com/features/copilot" },
  { name: "Cursor", category: "Editor / IDE", url: "https://cursor.com" },
  { name: "VS Code", category: "Editor / IDE", url: "https://code.visualstudio.com" },
  { name: "Vercel", category: "DevOps / Cloud", url: "https://vercel.com" },
  { name: "Supabase", category: "DevOps / Cloud", url: "https://supabase.com" },
  { name: "Figma", category: "Design", url: "https://figma.com" },
  { name: "Linear", category: "Productivity", url: "https://linear.app" },
].map((t, i) => ({ builder_profile_id: profileId, display_order: i, ...t }));
await admin.from("builder_profile_coding_tools").insert(codingTools);

const profileProjects = [
  {
    source: "manual",
    name: "Krowe Portal",
    description: "Operator–builder portal with an AI document pipeline (PRD → Quote → Contract) and e-signatures.",
    url: "https://krowehub.com",
    live_url: "https://krowehub.com",
    tech: ["Next.js", "Supabase", "TypeScript", "OpenAI"],
    display_order: 0,
  },
  {
    source: "manual",
    name: "KroweSignup",
    description: "AI-powered business signup that generates a tailored MVP build report from a few questions.",
    url: "https://krowehub.com",
    live_url: null,
    tech: ["Next.js", "OpenAI", "Supabase"],
    display_order: 1,
  },
].map((p) => ({ builder_profile_id: profileId, ...p }));
await admin.from("builder_profile_projects").insert(profileProjects);
console.log(`  ✓ ${experience.length} roles · ${codingTools.length} tools · ${profileProjects.length} projects`);

// ---- SOP / discovery transcript on the project ------------------------------
console.log("\nProject documents:");
await admin.from("project_sop_transcripts").delete().eq("project_id", project.id);
const sopContent =
  "Discovery call — Krowe Internal\n\n" +
  "Krowe: We're building the platform that operators and builders both live in. Right now the flow " +
  "is held together with Google Docs, spreadsheets, and email attachments. We want one place that " +
  "takes a prospect from the first call all the way to a signed contract, then runs the actual build " +
  "as a shared task board.\n\n" +
  "Builder: So the must-haves are the document pipeline — PRD, quote, contract with e-sign — and the " +
  "task board both sides can see. What about billing?\n\n" +
  "Krowe: Billing is phase two but it has to be in the plan: Stripe subscriptions plus a clean " +
  "investor-facing data room. Onboarding also matters — we lose people at the skills step today.\n\n" +
  "Builder: Got it. I'll draft the PRD around portal core, the document pipeline, onboarding/auth, " +
  "and billing + investor surfaces, then price it from there.";
const { error: sopErr } = await admin.from("project_sop_transcripts").insert({
  project_id: project.id,
  uploaded_by: builderId,
  label: "Discovery call — Krowe Internal",
  source_type: "paste",
  content: sopContent,
  char_count: sopContent.length,
});
if (sopErr) throw new Error(`sop: ${sopErr.message}`);
console.log(`  ✓ SOP transcript (${sopContent.length} chars)`);

// ---- PRD (signed) -----------------------------------------------------------
const prdContent = {
  overview:
    "Krowe is the operator–builder portal that turns a discovery call into a signed PRD, quote, and " +
    "contract, then runs the build as a shared task board. This internal build-out is Krowe dogfooding " +
    "Krowe — the same flow we sell, used to ship our own platform.",
  goals: [
    "Take a prospect from discovery call to signed contract without leaving the portal.",
    "Give operators a live view of build progress, documents, and spend in one place.",
    "Cut the time from 'yes' to first task shipped to under a week.",
  ],
  successMetrics: [
    "80% of new engagements complete PRD → Quote → Contract in-portal.",
    "Operators open the build board at least twice a week.",
  ],
  users: [
    {
      role: "Builder",
      description: "The engineer running the engagement.",
      authLevel: "Owner",
      permissions: ["Create projects & documents", "Manage tasks", "Invite operators"],
    },
    {
      role: "Operator (Client)",
      description: "The business owner the work is for.",
      authLevel: "Member",
      permissions: ["Review & sign documents", "Request tasks", "Track progress"],
    },
  ],
  features: [
    {
      title: "Build board",
      description: "A kanban of tasks across every engagement.",
      priority: "must",
      details: ["Inbox / In progress / Blocked / Done", "Operator-requested vs builder-added", "Per-engagement filter"],
    },
    {
      title: "Document pipeline",
      description: "PRD, Quote, and Contract with public e-sign links.",
      priority: "must",
      details: ["AI-assisted drafting", "Token-based public viewer", "Recorded e-signatures"],
    },
    { title: "GitHub repo view", description: "Tech stack, commits, and branches for the linked repo.", priority: "should" },
    { title: "Onboarding wizard", description: "Guided setup from signup to first task.", priority: "should" },
  ],
  pagesScreens: [
    { name: "Build Board", description: "Task kanban for the engagement.", displays: ["Tasks by status", "Engagement filter"] },
    { name: "Documents", description: "Project pipeline overview.", displays: ["Projects", "PRD / Quote / Contract status"] },
    { name: "Engagement", description: "The client workspace.", displays: ["Builder info", "Documents", "Linked repo"] },
  ],
  techStack: [
    { name: "Next.js", category: "Framework", layer: "frontend", provider: "Vercel", domain: "nextjs.org", includes: ["App Router", "Server Actions"] },
    { name: "Supabase", category: "Database & Auth", layer: "database", provider: "Supabase", domain: "supabase.com", includes: ["Postgres", "Row-level security", "Auth"] },
    { name: "OpenAI", category: "AI", layer: "backend", domain: "openai.com", includes: ["Document drafting"] },
    { name: "Stripe", category: "Billing", layer: "backend", domain: "stripe.com", includes: ["Subscriptions", "Metered billing"] },
  ],
  milestoneList: [
    { label: "Portal core + task board" },
    { label: "Document pipeline + e-sign" },
    { label: "Billing + investor surfaces" },
  ],
  assumptions: ["Client provides brand assets and production Stripe keys."],
  risks: ["Stripe production approval may gate go-live."],
};
const { data: prd, error: prdErr } = await admin
  .from("prds")
  .insert({
    project_id: project.id,
    created_by: builderId,
    title: "Krowe Internal — Product Requirements",
    status: "signed",
    content: prdContent,
    source_notes: "Drafted from the Krowe Internal discovery transcript.",
    sent_at: sentAtIso,
    signed_by_name: OPERATOR_SIGNER,
    signed_at: signedAtIso,
    signer_ip: SIGNER_IP,
    signature_consent: true,
  })
  .select("id, token")
  .single();
if (prdErr) throw new Error(`prd: ${prdErr.message}`);
console.log(`  ✓ PRD (signed) — token ${prd.token.slice(0, 8)}…`);

// ---- Quote (accepted) — priced from the PRD ---------------------------------
const quoteContent = {
  companyName: "Krowe",
  clientName: "Krowe",
  productSubtitle: "Operator–Builder Portal",
  scopeSummary:
    "Design, build, and ship the Krowe portal: a shared task board, the PRD/Quote/Contract document " +
    "pipeline with e-sign, onboarding & auth, and the billing + investor surfaces. Built on Next.js and Supabase.",
  modules: [
    {
      id: "m1",
      title: "Portal core",
      purpose: "Task board, engagements, projects",
      cost: 28000,
      lineItems: [
        { label: "Build board + task model", amount: 14000 },
        { label: "Engagements & projects", amount: 9000 },
        { label: "Operator / builder dashboards", amount: 5000 },
      ],
      subtotal: 28000,
    },
    {
      id: "m2",
      title: "Document pipeline",
      purpose: "PRD, Quote, Contract + e-sign",
      cost: 16000,
      lineItems: [
        { label: "AI drafting + document editors", amount: 9000 },
        { label: "Public token viewers + e-signature", amount: 7000 },
      ],
      subtotal: 16000,
    },
    {
      id: "m3",
      title: "Onboarding & auth",
      purpose: "Signup to first task",
      cost: 9000,
      lineItems: [
        { label: "Supabase auth + row-level security", amount: 5000 },
        { label: "Onboarding wizard", amount: 4000 },
      ],
      subtotal: 9000,
    },
    {
      id: "m4",
      title: "Billing & investor surfaces",
      purpose: "Stripe + investor data room",
      cost: 7000,
      lineItems: [
        { label: "Stripe subscriptions", amount: 4500 },
        { label: "Investor data room", amount: 2500 },
      ],
      subtotal: 7000,
    },
  ],
  extraCosts: [],
  designSystem: [
    { component: "Design system & component library", included: true },
    { component: "Responsive layouts", included: true },
    { component: "Dark mode", included: false, notes: "Out of scope for v1" },
  ],
  paymentMilestones: [
    { label: "Deposit", amount: 30000, percent: 50 },
    { label: "Midpoint", amount: 15000, percent: 25 },
    { label: "On delivery", amount: 15000, percent: 25 },
  ],
  justification: [
    "Senior full-stack delivery at AI-native velocity — one builder, no agency overhead.",
    "Fixed scope with milestone-based payment protection.",
  ],
  scopeProtection: ["Native mobile apps", "Integrations beyond Stripe and GitHub", "Content / data migration"],
  totals: { grand: 60000, modulesTotal: 60000, extrasTotal: 0, paymentTotal: 60000 },
  hourlyRate: 95,
  showHours: false,
  validityDays: 30,
  footerNote: "Prepared from the Krowe Internal PRD. Pricing is an estimate valid for 30 days.",
};
const { data: quote, error: quoteErr } = await admin
  .from("quotes")
  .insert({
    project_id: project.id,
    created_by: builderId,
    title: "Krowe Internal — Project Quote",
    status: "accepted",
    content: quoteContent,
    source_notes: "Priced from the Krowe Internal PRD.",
    source_prd_id: prd.id,
    sent_at: sentAtIso,
    signed_by_name: OPERATOR_SIGNER,
    signed_at: signedAtIso,
    signer_ip: SIGNER_IP,
    signature_consent: true,
    accepted_at: signedAtIso,
  })
  .select("id, token")
  .single();
if (quoteErr) throw new Error(`quote: ${quoteErr.message}`);
console.log(`  ✓ Quote (accepted, $60,000) — token ${quote.token.slice(0, 8)}…`);

// ---- Contract (sent — awaiting the operator's signature) --------------------
const contractContent = {
  parties: { provider: BUILDER.name, client: "Krowe" },
  effectiveDate: nowIso.slice(0, 10),
  scopeOfServices:
    "Provider will design, build, and deploy the Krowe operator–builder portal for Client, including " +
    "the shared task board, the document pipeline with e-signature, onboarding & auth, and the billing / " +
    "investor surfaces, as detailed in Exhibit A.",
  deliverables: [
    "Operator–builder portal (task board, engagements, projects).",
    "PRD / Quote / Contract pipeline with public e-sign.",
    "Onboarding wizard and Supabase auth.",
    "Stripe billing and investor data room.",
  ],
  fees: "Total project fee of $60,000, billed per the schedule in Exhibit B.",
  paymentTerms: "50% deposit, 25% at midpoint, 25% on delivery.",
  ipOwnership:
    "Upon receipt of full payment, Client owns all custom code, designs, and content created under this " +
    "agreement. Provider may display the work in their portfolio.",
  governingLaw:
    "This agreement is governed by the laws of the State of Texas. Any disputes will be resolved in the " +
    "courts of Travis County, Texas.",
  quoteTotal: 60000,
  scopeItems: [
    { title: "Portal core", purpose: "Task board, engagements, projects", cost: 28000 },
    { title: "Document pipeline", purpose: "PRD, Quote, Contract + e-sign", cost: 16000 },
    { title: "Onboarding & auth", purpose: "Signup to first task", cost: 9000 },
    { title: "Billing & investor surfaces", purpose: "Stripe + investor data room", cost: 7000 },
  ],
  paymentSchedule: [
    { label: "Deposit", amount: 30000, percent: 50 },
    { label: "Midpoint", amount: 15000, percent: 25 },
    { label: "On delivery", amount: 15000, percent: 25 },
  ],
};
const { data: contract, error: contractErr } = await admin
  .from("contracts")
  .insert({
    project_id: project.id,
    created_by: builderId,
    title: "Krowe Internal — Services Agreement",
    status: "sent",
    content: contractContent,
    source_notes: "Drafted from the Krowe Internal quote.",
    sent_at: nowIso,
  })
  .select("id, token")
  .single();
if (contractErr) throw new Error(`contract: ${contractErr.message}`);
console.log(`  ✓ Contract (sent, awaiting signature) — token ${contract.token.slice(0, 8)}…`);

// ---- summary ----------------------------------------------------------------
console.log("\n────────────────────────────────────────────");
console.log("DEMO ACCOUNT READY");
console.log("  Builder login : investinkrowe@krowehub.com   /  500kPlease@   → lands on /b");
console.log("  Client login  : krowe.internal@krowehub.com  /  500kPlease@   → operator side (optional)");
console.log("  Both emails are force-verified (email_confirm).");
console.log("  ----------------------------------------------------------");
console.log("  Project    : Krowe Internal  (1 project · 1 live engagement · 7 tasks)");
console.log("  Documents  : PRD signed · Quote accepted ($60,000) · Contract sent");
console.log(`  PRD token      : ${prd.token}`);
console.log(`  Quote token    : ${quote.token}`);
console.log(`  Contract token : ${contract.token}`);
console.log(`  Profile token  : ${profile.token}`);
console.log("────────────────────────────────────────────");
