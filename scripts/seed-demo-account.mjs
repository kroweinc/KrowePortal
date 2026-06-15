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

// ---- summary ----------------------------------------------------------------
console.log("\n────────────────────────────────────────────");
console.log("DEMO ACCOUNT READY");
console.log("  Builder login : investinkrowe@krowehub.com   /  500kPlease@   → lands on /b");
console.log("  Client login  : krowe.internal@krowehub.com  /  500kPlease@   → operator side (optional)");
console.log("  Both emails are force-verified (email_confirm).");
console.log("────────────────────────────────────────────");
