#!/usr/bin/env node
/**
 * Capture real, logged-in screenshots of every non-onboarding screen for the
 * Krowe demo accounts — the ground truth for updating the Figma design file.
 *
 * Reuses the dev server already running on :3030 (does NOT spawn one). Resolves
 * dynamic ids/tokens from Supabase (service role), then logs in as the builder,
 * the operator, and anonymously, screenshotting each route full-page at 1440px.
 * Writes PNGs under capture/{builder,operator,public}/ + a manifest.json that
 * records each screen's HTTP status and whether it rendered an empty/connect
 * state (the contract handed to the Figma step).
 *
 * Usage:  node scripts/capture-screens.mjs
 * Prereq: npm i -D playwright && npx playwright install chromium
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "capture");
const BASE = process.env.CAPTURE_BASE || "http://localhost:3030";

function env(key) {
  if (process.env[key]) return process.env[key];
  const line = readFileSync(join(root, ".env.local"), "utf8")
    .split("\n")
    .find((l) => l.trim().startsWith(`${key}=`));
  return line ? line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") : undefined;
}

const BUILDER = { email: "investinkrowe@krowehub.com", password: "500kPlease@" };
const OPERATOR = { email: "krowe.internal@krowehub.com", password: "500kPlease@" };

const admin = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---- resolve dynamic ids / tokens from the seeded data ----------------------
console.log("Resolving seeded records…");
const { data: project } = await admin
  .from("projects")
  .select("id, owner_id")
  .eq("name", "Krowe Internal")
  .order("created_at", { ascending: false })
  .limit(1)
  .single();
const builderId = project.owner_id;
const P = project.id;
const { data: eng } = await admin
  .from("engagements")
  .select("id, operator_id")
  .eq("project_id", P)
  .order("created_at", { ascending: false })
  .limit(1)
  .single();
const { data: tasks } = await admin.from("tasks").select("id, status, title").eq("engagement_id", eng.id);
const task = tasks.find((t) => t.status === "in_progress") || tasks[0];
const { data: prd } = await admin.from("prds").select("id, token").eq("project_id", P).limit(1).single();
const { data: quote } = await admin.from("quotes").select("id, token").eq("project_id", P).limit(1).single();
const { data: contract } = await admin.from("contracts").select("id, token").eq("project_id", P).limit(1).single();
const { data: prof } = await admin.from("builder_profiles").select("token").eq("user_id", builderId).single();
console.log(`  project ${P}\n  engagement ${eng.id}\n  task ${task.id} (${task.status})`);

// ---- route lists ------------------------------------------------------------
const builderRoutes = [
  ["b-dashboard", "/b"],
  ["b-projects", "/b/projects"],
  ["b-projects-new", "/b/projects/new"],
  ["b-project-detail", `/b/projects/${P}`],
  ["b-prd-new", `/b/projects/${P}/prd/new`],
  ["b-prd-editor", `/b/projects/${P}/prd/${prd.id}`],
  ["b-quote-new", `/b/projects/${P}/quotes/new`],
  ["b-quote-editor", `/b/projects/${P}/quotes/${quote.id}`],
  ["b-contract-new", `/b/projects/${P}/contract/new`],
  ["b-contract-editor", `/b/projects/${P}/contract/${contract.id}`],
  ["b-engagements", "/b/engagements"],
  ["b-engagement-detail", `/b/engagements/${eng.id}`],
  ["b-task-detail", `/b/tasks/${task.id}`],
  ["b-github", "/b/github"],
  ["b-settings", "/b/settings"],
  ["b-settings-security", "/b/settings/security"],
  ["b-settings-github", "/b/settings/github"],
  ["b-settings-quotes", "/b/settings/quotes"],
  ["b-settings-notifications", "/b/settings/notifications"],
  ["b-profile", "/b/profile"],
  ["b-profile-preview", "/p/preview"],
];
const operatorRoutes = [
  ["o-dashboard", "/o"],
  ["o-project", "/o/project"],
  ["o-engagement", "/o/engagement"],
  ["o-task-detail", `/o/tasks/${task.id}`],
  ["o-prd", `/o/prd/${prd.token}`],
  ["o-quote", `/o/quotes/${quote.token}`],
  ["o-contract", `/o/contract/${contract.token}`],
  ["o-settings", "/o/settings"],
  ["o-settings-security", "/o/settings/security"],
  ["o-settings-notifications", "/o/settings/notifications"],
];
const publicRoutes = [
  ["public-prd", `/prd/${prd.token}`],
  ["public-quote", `/quotes/${quote.token}`],
  ["public-contract", `/contract/${contract.token}`],
  ["public-profile", `/p/${prof.token}`],
];

for (const d of ["builder", "operator", "public"]) mkdirSync(join(OUT, d), { recursive: true });

const EMPTY_HINTS = [
  "not connected",
  "connect github",
  "connect your github",
  "no repo linked",
  "code not connected",
  "not connected yet",
];
const manifest = [];

async function login(page, { email, password }) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  // Robust: resolve as soon as we leave /login, regardless of role destination.
  await page.waitForFunction(() => !location.pathname.startsWith("/login"), null, { timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => {});
  console.log(`  → logged in, landed on ${new URL(page.url()).pathname}`);
}

async function snap(ctx, dir, name, route) {
  const page = await ctx.newPage();
  let status = "ok";
  let httpCode = null;
  try {
    const resp = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 60000 });
    httpCode = resp ? resp.status() : null;
  } catch (e) {
    status = "load-incomplete";
    await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
  }
  await page.waitForTimeout(700); // let fonts / async cards settle
  const body = ((await page.textContent("body").catch(() => "")) || "").toLowerCase();
  const emptyState = EMPTY_HINTS.some((h) => body.includes(h));
  const notFound = httpCode === 404 || body.includes("this page could not be found");
  await page.screenshot({ path: join(OUT, dir, `${name}.png`), fullPage: true }).catch(() => {});
  const flags = [status !== "ok" ? status : null, `http ${httpCode ?? "?"}`, emptyState ? "EMPTY" : null, notFound ? "404?" : null]
    .filter(Boolean)
    .join(" · ");
  console.log(`  ${dir}/${name.padEnd(24)} ${route.padEnd(42)} ${flags}`);
  manifest.push({ name, route, dir, httpCode, status, emptyState, notFound });
  await page.close();
}

const browser = await chromium.launch();
const ctxOpts = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };

// ---- builder pass (clean context — no dev_role cookie) ----------------------
console.log("\nBuilder pass:");
{
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  await login(page, BUILDER);
  await page.close();
  for (const [name, route] of builderRoutes) await snap(ctx, "builder", name, route);
  await ctx.close();
}

// ---- operator pass ----------------------------------------------------------
console.log("\nOperator pass:");
{
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  await login(page, OPERATOR);
  await page.close();
  for (const [name, route] of operatorRoutes) await snap(ctx, "operator", name, route);
  await ctx.close();
}

// ---- public pass (anonymous) ------------------------------------------------
console.log("\nPublic pass:");
{
  const ctx = await browser.newContext(ctxOpts);
  for (const [name, route] of publicRoutes) await snap(ctx, "public", name, route);
  await ctx.close();
}

await browser.close();

writeFileSync(
  join(OUT, "manifest.json"),
  JSON.stringify(
    { capturedAt: new Date().toISOString(), data: { project: P, engagement: eng.id, task: task.id, prd, quote, contract, profileToken: prof.token }, screens: manifest },
    null,
    2
  )
);
const empties = manifest.filter((m) => m.emptyState).map((m) => m.name);
const issues = manifest.filter((m) => m.notFound || m.status !== "ok").map((m) => `${m.name}(${m.notFound ? "404" : m.status})`);
console.log(`\n✓ ${manifest.length} screens captured → capture/`);
console.log(`  empty-state screens: ${empties.join(", ") || "none"}`);
console.log(`  needs-attention    : ${issues.join(", ") || "none"}`);
