#!/usr/bin/env node
/**
 * One-off backfill: reformat existing task descriptions from paragraphs into
 * bullet points, WITHOUT changing their meaning. Companion to the prompt change
 * that makes newly-generated descriptions bulleted — this converts the ~154
 * pre-existing paragraph descriptions so old and new tasks look consistent.
 *
 * Uses the service-role key (bypasses RLS). Reads creds from .env.local.
 * Only the `description` column is ever written; nothing else is touched.
 *
 * The "Plain English" simplified view is NOT stored in the DB (it lives in the
 * browser's localStorage and regenerates on demand), so it needs no backfill —
 * this only touches tasks.description.
 *
 * Modes (safe → destructive):
 *   node scripts/backfill-bullet-descriptions.mjs backup
 *       Dump {id,title,status,description} for every task w/ a description to a
 *       timestamped JSON in the out dir. Run this first — it's the undo file.
 *
 *   node scripts/backfill-bullet-descriptions.mjs dry-run [limit]
 *       Reformat via the LLM and write {id,title,before,after,ok,reason} to a
 *       review JSON. NO database writes. Optional limit for a quick sample.
 *
 *   node scripts/backfill-bullet-descriptions.mjs apply [limit]
 *       Reformat and UPDATE tasks.description for rows that pass validation.
 *       Skips rows already bulleted and any row whose reformat looks unsafe.
 *       Writes an applied-log (before/after per row) for reversibility.
 *
 *   node scripts/backfill-bullet-descriptions.mjs restore <backup-file.json>
 *       Restore descriptions verbatim from a backup file (full undo).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT =
  process.env.BACKFILL_OUT ||
  "/private/tmp/claude-501/-Users-stevenortega-KrowePortal/360feae0-4a1c-4425-b93f-0c4257321d69/scratchpad";

function env(key) {
  if (process.env[key]) return process.env[key];
  const line = readFileSync(join(root, ".env.local"), "utf8")
    .split("\n")
    .find((l) => l.trim().startsWith(`${key}=`));
  if (!line) return undefined;
  let v = line.slice(line.indexOf("=") + 1).trim();
  const quoted =
    (v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"));
  if (quoted) return v.slice(1, -1);
  return v.replace(/\s+#.*$/, "").trim(); // strip inline comments on unquoted values
}

const url = env("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
const openaiKey = env("OPENAI_API_KEY");
const MODEL = env("OPENAI_MODEL") || "gpt-5.4-mini";
const EFFORT = (() => {
  const raw = (env("OPENAI_REASONING_EFFORT") || "low").trim().toLowerCase();
  return ["minimal", "low", "medium", "high"].includes(raw) ? raw : null;
})();

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const db = createClient(url, serviceKey);
const openai = openaiKey ? new OpenAI({ apiKey: openaiKey, timeout: 120_000 }) : null;

const ts = () => new Date().toISOString().replace(/[:.]/g, "-");
const isBulleted = (d) => {
  const t = (d ?? "").trimStart();
  return t.startsWith("•") || t.startsWith("- ");
};

const REFORMAT_SYSTEM = `You reformat an existing software task description into a bullet list WITHOUT changing its meaning.

Rules:
- Restructure the existing content into 3–6 concise bullet points, each on its own line starting with "• ".
- Do NOT add new information, and do NOT drop any fact, name, number, date, email address, or quoted text — preserve every such value VERBATIM.
- Do not editorialize, re-scope, or reword beyond what is needed to split the prose into bullets.
- Bullets only: no intro sentence, no trailing paragraph, no headings.
- If the input is a single short line that is already effectively one point, return it as a single "• " bullet.

Return ONLY JSON in this exact shape: {"description":"• …\\n• …"}
No markdown fences, no commentary — raw JSON only.`;

async function reformat(description) {
  const res = await openai.chat.completions.create({
    model: MODEL,
    ...(EFFORT ? { reasoning_effort: EFFORT } : {}),
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: REFORMAT_SYSTEM },
      { role: "user", content: description },
    ],
  });
  const raw = res.choices[0]?.message?.content ?? "";
  const parsed = JSON.parse(raw);
  return String(parsed.description ?? "").trim();
}

// Validate a reformatted description before it is allowed to overwrite the original.
function validate(before, after) {
  if (!after) return { ok: false, reason: "empty result" };
  if (!after.includes("•")) return { ok: false, reason: "no bullet char" };
  if (after.length < 20) return { ok: false, reason: `too short (${after.length})` };
  if (after.length > 2000) return { ok: false, reason: `too long (${after.length})` };
  // Guard against the model silently dropping content: bulleted text is usually
  // >= the original length (it adds "• " and newlines). Flag big shrinkage.
  if (after.replace(/[•\s]/g, "").length < before.replace(/\s/g, "").length * 0.6) {
    return { ok: false, reason: "lost >40% of content" };
  }
  return { ok: true, reason: "" };
}

async function pool(items, size, worker) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await worker(items[idx], idx);
      }
    })
  );
  return out;
}

async function fetchParagraphRows(limit) {
  let q = db
    .from("tasks")
    .select("id,title,status,description")
    .not("description", "is", null)
    .order("created_at", { ascending: true });
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []).filter(
    (r) => r.description && r.description.trim().length > 0 && !isBulleted(r.description)
  );
  return limit ? rows.slice(0, limit) : rows;
}

async function cmdBackup() {
  const { data, error } = await db
    .from("tasks")
    .select("id,title,status,description")
    .not("description", "is", null);
  if (error) throw error;
  const file = join(OUT, `desc-backup-${ts()}.json`);
  writeFileSync(file, JSON.stringify(data, null, 2));
  console.log(`Backed up ${data.length} descriptions → ${file}`);
}

async function reformatRows(rows) {
  let done = 0;
  return pool(rows, 5, async (r) => {
    let after = "";
    let err = null;
    try {
      after = await reformat(r.description);
    } catch (e) {
      err = e?.message ?? String(e);
    }
    const v = err ? { ok: false, reason: `error: ${err}` } : validate(r.description, after);
    done++;
    if (done % 10 === 0) console.log(`  …${done}/${rows.length}`);
    return { id: r.id, title: r.title, status: r.status, before: r.description, after, ...v };
  });
}

async function cmdDryRun(limit) {
  if (!openai) throw new Error("OPENAI_API_KEY missing — cannot reformat");
  const rows = await fetchParagraphRows(limit);
  console.log(`Reformatting ${rows.length} paragraph descriptions (dry run, no writes)…`);
  const results = await reformatRows(rows);
  const file = join(OUT, `desc-dryrun-${ts()}.json`);
  writeFileSync(file, JSON.stringify(results, null, 2));
  const okCount = results.filter((r) => r.ok).length;
  const bad = results.filter((r) => !r.ok);
  console.log(`\nReview file → ${file}`);
  console.log(`OK: ${okCount}/${results.length}   Flagged (would be skipped): ${bad.length}`);
  if (bad.length) console.log("Flagged reasons:", bad.map((b) => `${b.id.slice(0, 8)}:${b.reason}`).join(", "));
  console.log("\n=== SAMPLE (first 3 OK rows) ===");
  for (const r of results.filter((r) => r.ok).slice(0, 3)) {
    console.log(`\n[${r.title}]`);
    console.log("BEFORE:", JSON.stringify(r.before));
    console.log("AFTER :\n" + r.after);
  }
}

async function cmdApply(limit) {
  if (!openai) throw new Error("OPENAI_API_KEY missing — cannot reformat");
  const rows = await fetchParagraphRows(limit);
  console.log(`Reformatting + applying ${rows.length} descriptions…`);
  const results = await reformatRows(rows);
  const applied = [];
  let skipped = 0;
  for (const r of results) {
    if (!r.ok) {
      skipped++;
      continue;
    }
    const { error } = await db.from("tasks").update({ description: r.after }).eq("id", r.id);
    if (error) {
      console.error(`  update failed ${r.id}: ${error.message}`);
      skipped++;
      continue;
    }
    applied.push({ id: r.id, before: r.before, after: r.after });
  }
  const file = join(OUT, `desc-applied-${ts()}.json`);
  writeFileSync(file, JSON.stringify(applied, null, 2));
  console.log(`\nApplied ${applied.length}, skipped ${skipped}. Applied-log → ${file}`);
}

async function cmdRestore(fileArg) {
  if (!fileArg) throw new Error("restore requires a backup file path");
  const rows = JSON.parse(readFileSync(fileArg, "utf8"));
  let n = 0;
  for (const r of rows) {
    const { error } = await db.from("tasks").update({ description: r.description }).eq("id", r.id);
    if (error) console.error(`  restore failed ${r.id}: ${error.message}`);
    else n++;
  }
  console.log(`Restored ${n}/${rows.length} descriptions from ${fileArg}`);
}

const [mode, arg] = process.argv.slice(2);
const limit = arg && /^\d+$/.test(arg) ? Number(arg) : undefined;
const run = {
  backup: () => cmdBackup(),
  "dry-run": () => cmdDryRun(limit),
  apply: () => cmdApply(limit),
  restore: () => cmdRestore(arg),
}[mode];

if (!run) {
  console.error("Usage: backfill-bullet-descriptions.mjs [backup|dry-run|apply|restore] [limit|file]");
  process.exit(1);
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
