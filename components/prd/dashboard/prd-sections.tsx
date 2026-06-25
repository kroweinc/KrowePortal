"use client";

/* PRD section renderers. Each section's Body uses the inline primitives, so the
   same component serves read + edit (InlineText handles the mode switch). The
   SECTIONS registry drives the rail TOC and the content order. Ported from the
   Claude Design prototype's prd-sections.jsx. */

import { useState, useEffect, type ComponentType, type ReactNode } from "react";
import { toast } from "sonner";
import type { PrdContent, PrdPriority, PrdStackItem, PrdIntegration, FreeTierAssumption, FreeTierAnalysis, PrdMilestone } from "@/lib/types";
import type { StackLookup, IntegrationLookup } from "@/lib/ai/lookup-stack-item";
import {
  lookupStackItemAction,
  lookupIntegrationItemAction,
  reconcileTechReferencesAction,
} from "@/lib/actions/lookup-tech";
import { analyzeFreeTierFitAction } from "@/lib/actions/free-tier";
import { renameTechAcrossPrd } from "@/lib/prd/rename-tech";
import { flowSteps } from "@/lib/prd/flow-steps";
import { InlineText, InlineList, InlineSelect, AddButton, RemoveCard, useEditing } from "./inline-edit";
import { priceRange } from "./prd-summary";
import { BrandLogo } from "../brand-logo";

/** Patch the PRD content. Accepts a partial (merged onto the current content) or
    a functional updater — the latter lets async work (e.g. the tech-stack
    auto-lookup) apply against the freshest state instead of a stale closure. */
export type PrdPatch = (p: Partial<PrdContent> | ((prev: PrdContent) => Partial<PrdContent>)) => void;

export interface SectionBodyProps {
  content: PrdContent;
  patch: PrdPatch;
}

const PRIORITY_OPTS = [
  { value: "must", label: "must" },
  { value: "should", label: "should" },
  { value: "could", label: "could" },
];
export const PRIORITY_LABEL: Record<PrdPriority, string> = { must: "Must", should: "Should", could: "Could" };
const DIRECTION_OPTS = [
  { value: "import", label: "import" },
  { value: "export", label: "export" },
  { value: "both", label: "both" },
];
type StackLayer = NonNullable<PrdStackItem["layer"]>;
const STACK_LAYER_ORDER: StackLayer[] = ["frontend", "backend", "database", "email", "hosting", "other"];
const STACK_LAYER_LABEL: Record<StackLayer, string> = {
  frontend: "Frontend",
  backend: "Backend",
  database: "Database",
  email: "Email",
  hosting: "Hosting",
  other: "Other",
};

// --- list-of-objects helpers -----------------------------------------
function listPatch<T>(arr: T[], patch: (p: Partial<PrdContent>) => void, key: keyof PrdContent) {
  return {
    update: (i: number, p: Partial<T>) =>
      patch({ [key]: arr.map((it, idx) => (idx === i ? { ...it, ...p } : it)) } as Partial<PrdContent>),
    remove: (i: number) => patch({ [key]: arr.filter((_, idx) => idx !== i) } as Partial<PrdContent>),
    add: (blank: T) => patch({ [key]: [...arr, blank] } as Partial<PrdContent>),
  };
}

function EstimateBanner({ flags }: { flags: (boolean | undefined)[] }) {
  if (!flags.some(Boolean)) return null;
  return <p className="estimate-banner">Some costs are AI estimates — verify with the vendor before sending.</p>;
}

function Cost({
  value,
  estimated,
  onChange,
}: {
  value?: string | null;
  estimated?: boolean;
  onChange?: (v: string) => void;
}) {
  const editing = useEditing();
  if (!value && !editing) return null;
  return (
    <span className="cost-pill">
      <InlineText value={value} onChange={onChange ?? (() => {})} placeholder="$/mo" mono />
      {estimated && <span className="cost-est">est.</span>}
    </span>
  );
}

// --- auto-lookup: rename an item → repopulate it from the new name -----------
// Both §8 (integrations) and §9 (tech stack) fire an AI lookup when the builder
// renames an item and OVERWRITE the surrounding fields with the looked-up facts.
// A field the lookup couldn't determine (null/empty) keeps its prior value, so a
// flaky or unrecognized lookup never wipes the card.

/** Overwrite a stack item with looked-up facts; keep prior values only where the
    lookup returned nothing. */
function fillStack(it: PrdStackItem, f: StackLookup): PrdStackItem {
  return {
    ...it,
    provider: f.provider ?? it.provider ?? null,
    category: f.category ?? it.category ?? null,
    layer: f.layer ?? it.layer ?? null,
    includes: f.includes && f.includes.length ? f.includes : it.includes ?? [],
    monthlyCost: f.monthlyCost ?? it.monthlyCost ?? null,
    estimated: f.monthlyCost ? true : it.estimated,
    domain: f.domain ?? it.domain ?? null,
  };
}

function fillIntegration(it: PrdIntegration, f: IntegrationLookup): PrdIntegration {
  return {
    ...it,
    purpose: f.purpose ?? it.purpose ?? null,
    monthlyCost: f.monthlyCost ?? it.monthlyCost ?? null,
    estimated: f.monthlyCost ? true : it.estimated,
    domain: f.domain ?? it.domain ?? null,
  };
}

/** Small "finding…" tag shown on a card while its lookup is in flight. */
function LookupPill({ on }: { on: boolean }) {
  if (!on) return null;
  return (
    <span className="lookup-pill" aria-live="polite">
      <span className="lookup-spinner" aria-hidden="true" />
      finding…
    </span>
  );
}

// =====================================================================
//  Structured section bodies
// =====================================================================

function UsersBody({ content, patch }: SectionBodyProps) {
  const users = content.users ?? [];
  const h = listPatch(users, patch, "users");
  return (
    <div className="card-stack">
      {users.map((u, i) => (
        <div className="prd-card" key={i}>
          <RemoveCard onClick={() => h.remove(i)} />
          <div className="prd-card__head">
            <InlineText
              value={u.role}
              onChange={(v) => h.update(i, { role: v })}
              placeholder="User type"
              className="prd-card__title"
            />
            <span className="auth-pill">
              <InlineText value={u.authLevel} onChange={(v) => h.update(i, { authLevel: v })} placeholder="level" />
            </span>
          </div>
          <InlineText
            value={u.description}
            onChange={(v) => h.update(i, { description: v })}
            placeholder="What this user does"
            className="prd-card__desc"
            multiline
          />
          <p className="prd-card__label">Permissions — what they can do</p>
          <InlineList
            items={u.permissions ?? []}
            onChange={(v) => h.update(i, { permissions: v })}
            variant="bullet"
            addLabel="permission"
            placeholder="Permission"
          />
        </div>
      ))}
      <AddButton label="Add user type" onClick={() => h.add({ role: "", authLevel: "", description: "", permissions: [] })} />
    </div>
  );
}

function FeaturesBody({ content, patch }: SectionBodyProps) {
  const features = content.features ?? [];
  const h = listPatch(features, patch, "features");
  return (
    <div className="card-stack">
      {features.map((f, i) => (
        <div className="prd-card" key={i}>
          <RemoveCard onClick={() => h.remove(i)} />
          <div className="prd-card__head">
            <InlineText
              value={f.title}
              onChange={(v) => h.update(i, { title: v })}
              placeholder="Feature"
              className="prd-card__title"
            />
            <span className={"prio prio--" + (f.priority ?? "should")}>
              <InlineSelect
                value={f.priority ?? "should"}
                onChange={(v) => h.update(i, { priority: v as PrdPriority })}
                options={PRIORITY_OPTS}
                render={(v) => PRIORITY_LABEL[v as PrdPriority]}
              />
            </span>
          </div>
          <InlineText
            value={f.description}
            onChange={(v) => h.update(i, { description: v })}
            placeholder="Short description"
            className="prd-card__desc"
            multiline
          />
          <p className="prd-card__label">Details — fields, columns, statuses, actions</p>
          <InlineList items={f.details ?? []} onChange={(v) => h.update(i, { details: v })} addLabel="detail" placeholder="Detail" />
          <p className="prd-card__label">Examples — illustrative sample values</p>
          <InlineList
            items={f.examples ?? []}
            onChange={(v) => h.update(i, { examples: v })}
            variant="plain"
            addLabel="example"
            placeholder="Example"
          />
        </div>
      ))}
      <AddButton
        label="Add feature"
        onClick={() => h.add({ title: "", description: "", priority: "should", details: [], examples: [] })}
      />
    </div>
  );
}

function PagesBody({ content, patch }: SectionBodyProps) {
  const pages = content.pagesScreens ?? [];
  const h = listPatch(pages, patch, "pagesScreens");
  return (
    <div className="card-stack">
      {pages.map((p, i) => (
        <div className="prd-card" key={i}>
          <RemoveCard onClick={() => h.remove(i)} />
          <InlineText
            value={p.name}
            onChange={(v) => h.update(i, { name: v })}
            placeholder="Page name"
            className="prd-card__title"
          />
          <InlineText
            value={p.description}
            onChange={(v) => h.update(i, { description: v })}
            placeholder="What this page is for"
            className="prd-card__desc"
            multiline
          />
          <p className="prd-card__label">Displays — what it shows or lets the user do</p>
          <InlineList items={p.displays ?? []} onChange={(v) => h.update(i, { displays: v })} addLabel="element" placeholder="Element" />
        </div>
      ))}
      <AddButton label="Add page" onClick={() => h.add({ name: "", description: "", displays: [] })} />
    </div>
  );
}

function DataModelBody({ content, patch }: SectionBodyProps) {
  const rows = content.dataModel ?? [];
  const h = listPatch(rows, patch, "dataModel");
  return (
    <div className="card-stack">
      {rows.map((d, i) => (
        <div className="prd-card prd-card--row" key={i}>
          <RemoveCard onClick={() => h.remove(i)} />
          <div className="prd-card__head">
            <InlineText
              value={d.data}
              onChange={(v) => h.update(i, { data: v })}
              placeholder="Data"
              className="prd-card__title"
            />
            <span className="dir-pill">
              <InlineSelect
                value={d.direction ?? "import"}
                onChange={(v) => h.update(i, { direction: v as "import" | "export" | "both" })}
                options={DIRECTION_OPTS}
                render={(v) => v}
              />
            </span>
          </div>
          <div className="data-source">
            <InlineText value={d.source} onChange={(v) => h.update(i, { source: v })} placeholder="Source" />
          </div>
        </div>
      ))}
      <AddButton label="Add data source" onClick={() => h.add({ data: "", direction: "import", source: "" })} />
    </div>
  );
}

function IntegrationsBody({ content, patch }: SectionBodyProps) {
  const rows = content.integrations ?? [];
  const h = listPatch(rows, patch, "integrations");
  const editing = useEditing();
  const [busy, setBusy] = useState<number[]>([]);
  const ctx = content.overview ?? "";

  function renameAndLookup(i: number, value: string) {
    h.update(i, { name: value });
    const name = value.trim();
    if (!editing || name.length < 2) return;
    setBusy((b) => [...b, i]);
    lookupIntegrationItemAction(name, ctx)
      .then((res) => {
        if (!("data" in res)) {
          toast.error(res.error);
          return;
        }
        patch((prev) => {
          const cur = prev.integrations ?? [];
          if (!cur[i] || (cur[i].name ?? "").trim() !== name) return {}; // row moved or renamed again
          return { integrations: cur.map((it, idx) => (idx === i ? fillIntegration(it, res.data) : it)) };
        });
      })
      .catch(() => toast.error("Lookup failed."))
      .finally(() => setBusy((b) => b.filter((x) => x !== i)));
  }

  return (
    <div className="card-stack">
      <EstimateBanner flags={rows.map((r) => r.estimated)} />
      {rows.map((it, i) => (
        <div className="prd-card" key={i}>
          <RemoveCard onClick={() => h.remove(i)} />
          <div className="prd-card__head">
            <BrandLogo domain={it.domain} name={it.name} />
            <InlineText
              value={it.name}
              onChange={(v) => renameAndLookup(i, v)}
              placeholder="Software"
              className="prd-card__title"
            />
            <LookupPill on={busy.includes(i)} />
            <Cost value={it.monthlyCost} estimated={it.estimated} onChange={(v) => h.update(i, { monthlyCost: v })} />
          </div>
          <InlineText
            value={it.purpose}
            onChange={(v) => h.update(i, { purpose: v })}
            placeholder="What it's for"
            className="prd-card__desc"
          />
        </div>
      ))}
      <AddButton label="Add software" onClick={() => h.add({ name: "", purpose: "", monthlyCost: "", estimated: false })} />
    </div>
  );
}

function TechStackBody({ content, patch }: SectionBodyProps) {
  const items = content.techStack ?? [];
  const h = listPatch(items, patch, "techStack");
  const editing = useEditing();
  const [busy, setBusy] = useState<number[]>([]);
  const ctx = content.overview ?? "";

  function renameAndLookup(idx: number, value: string) {
    // The pre-edit name — used both for the literal cascade and the semantic pass.
    const oldName = (items[idx]?.name ?? "").trim();

    // Renaming a stack item cascades its old name to the new one everywhere in the
    // PRD — duplicate stack rows, the matching §8 integration, Free-Tier Fit
    // verdicts, and any prose that mentions it. A brand-new/blank row (no real prior
    // name) or a no-op edit just sets this row's own name.
    patch((prev) => {
      const old = (prev.techStack?.[idx]?.name ?? "").trim();
      if (old.length < 2 || old === value.trim()) {
        return { techStack: (prev.techStack ?? []).map((it, i) => (i === idx ? { ...it, name: value } : it)) };
      }
      return renameTechAcrossPrd(prev, old, value);
    });
    const name = value.trim();
    if (!editing || name.length < 2) return;

    // Literal matching can't catch every leftover: the old tech may be named in a
    // different form ("AWS" vs "Amazon Web Services") or as a separate §8 entry. A
    // semantic pass lists the exact phrases that still denote the old tech, which we
    // then run through the same deterministic cascade. AI only names strings — it
    // never rewrites prose — so the document edit stays bounded and safe.
    if (oldName.length >= 2 && oldName.toLowerCase() !== name.toLowerCase()) {
      reconcileTechReferencesAction(oldName, name, content)
        .then((res) => {
          if (!("data" in res) || res.data.length === 0) return;
          patch((prev) => renameTechAcrossPrd(prev, res.data, name));
          const n = res.data.length;
          toast.success(`Updated ${n} more reference${n > 1 ? "s" : ""} to “${oldName}”.`);
        })
        .catch(() => {});
    }
    setBusy((b) => [...b, idx]);
    lookupStackItemAction(name, ctx)
      .then((res) => {
        if (!("data" in res)) {
          toast.error(res.error);
          return;
        }
        patch((prev) => {
          const cur = prev.techStack ?? [];
          if (!cur[idx] || (cur[idx].name ?? "").trim() !== name) return {}; // row moved or renamed again
          return { techStack: cur.map((it, i) => (i === idx ? fillStack(it, res.data) : it)) };
        });
      })
      .catch(() => toast.error("Lookup failed."))
      .finally(() => setBusy((b) => b.filter((x) => x !== idx)));
  }

  const groups = STACK_LAYER_ORDER.map((layer) => ({
    layer,
    items: items.map((it, idx) => ({ it, idx })).filter(({ it }) => (it.layer ?? "other") === layer),
  })).filter((g) => g.items.length > 0);
  return (
    <div className="card-stack">
      <EstimateBanner flags={items.map((r) => r.estimated)} />
      {groups.map((g) => (
        <div className="stack-group" key={g.layer}>
          <h4 className="stack-group__head">{STACK_LAYER_LABEL[g.layer]}</h4>
          {g.items.map(({ it, idx }) => (
            <div className="prd-card" key={idx}>
              <RemoveCard onClick={() => h.remove(idx)} />
              <div className="prd-card__head">
                <BrandLogo domain={it.domain} name={it.name} />
                <InlineText
                  value={it.name}
                  onChange={(v) => renameAndLookup(idx, v)}
                  placeholder="Technology"
                  className="prd-card__title"
                />
                <LookupPill on={busy.includes(idx)} />
                <Cost value={it.monthlyCost} estimated={it.estimated} onChange={(v) => h.update(idx, { monthlyCost: v })} />
              </div>
              <p className="prd-card__label">Includes — what this layer covers</p>
              <InlineList items={it.includes ?? []} onChange={(v) => h.update(idx, { includes: v })} addLabel="item" placeholder="Covered" />
            </div>
          ))}
        </div>
      ))}
      <AddButton
        label="Add stack item"
        onClick={() => h.add({ name: "", provider: "", layer: "other", monthlyCost: "", estimated: false, includes: [] })}
      />
    </div>
  );
}

// --- Free-Tier Fit (companion to §8/§9) --------------------------------------
// Runs an AI analysis of whether the product can stay on each
// service's free tier and what dimension forces the first paid upgrade. The
// action is pure; its result is patched into content.freeTierAnalysis and persists
// on the normal Save. Builder-only (not rendered in the client-facing document).

const FIT_LABEL: Record<"yes" | "risky" | "no", string> = {
  yes: "Fits free",
  risky: "Risky",
  no: "Paid needed",
};

function FitPill({ verdict }: { verdict: "yes" | "risky" | "no" }) {
  return <span className={`fit fit--${verdict}`}>{FIT_LABEL[verdict]}</span>;
}

/** Read-only cost pill (derived estimate — not editable like the §8/§9 Cost). */
function CostTag({ value }: { value?: string | null }) {
  if (!value) return null;
  return (
    <span className="cost-pill">
      {value}
      <span className="cost-est">est.</span>
    </span>
  );
}

function formatChecked(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

const normName = (s?: string | null) => (s ?? "").trim().toLowerCase();

/** Normalized names of every service currently in the stack + integrations. */
function currentServiceNames(content: PrdContent): Set<string> {
  const names = [
    ...(content.techStack ?? []).map((s) => s.name),
    ...(content.integrations ?? []).map((s) => s.name),
  ];
  return new Set(names.map(normName).filter(Boolean));
}

/** Has the stack changed since the analysis ran? Compares the current stack +
    integration names against the snapshot the server stamped at run time
    (analyzedStack). This is true staleness — a service added, removed, or renamed
    (e.g. SendGrid → Resend). It deliberately does NOT compare against the verdict
    names: the model infers concrete providers ("Vercel", "Supabase") from abstract
    stack entries ("Managed hosting", "Managed PostgreSQL database"), which never
    matched lexically and used to flag every fresh analysis as stale. Legacy
    analyses with no snapshot are never auto-stale (the builder can re-check). */
function freeTierStale(content: PrdContent, analysis?: FreeTierAnalysis | null): boolean {
  if (!analysis || analysis.analyzedStack == null) return false;
  const now = currentServiceNames(content);
  const then = new Set(analysis.analyzedStack.map(normName).filter(Boolean));
  if (now.size !== then.size) return true;
  for (const n of now) if (!then.has(n)) return true;
  return false;
}

/** Best logo domain for a free-tier verdict: reuse the domain already saved on
    the matching §8/§9 item (matched leniently by name/provider). Returns null when
    no match has a domain — BrandLogo then falls back to its built-in name directory. */
function domainForVerdict(content: PrdContent, v: { name: string; provider?: string | null }): string | null {
  const items = [...(content.techStack ?? []), ...(content.integrations ?? [])];
  const candidates = [normName(v.name), normName(v.provider)].filter(Boolean);
  // Exact name match first.
  for (const it of items) {
    if (it.domain && candidates.includes(normName(it.name))) return it.domain;
  }
  // Lenient substring match either way for trivial naming differences.
  for (const it of items) {
    const itName = normName(it.name);
    if (!itName || !it.domain) continue;
    if (candidates.some((c) => itName.includes(c) || c.includes(itName))) return it.domain;
  }
  return null;
}

/** Coerce stored assumptions into editable {label, value} stats. Tolerates a
    legacy cached analysis where assumptions were plain sentences (string[]) by
    splitting on the first colon ("Assumed ~5,000 MAU" → label only). */
function normalizeAssumptions(raw: unknown): FreeTierAssumption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((a): FreeTierAssumption => {
      if (typeof a === "string") {
        const idx = a.indexOf(":");
        return idx > 0
          ? { label: a.slice(0, idx).trim(), value: a.slice(idx + 1).trim() }
          : { label: a.trim(), value: "" };
      }
      if (a && typeof a === "object") {
        const o = a as { label?: unknown; value?: unknown };
        return { label: String(o.label ?? "").trim(), value: String(o.value ?? "").trim() };
      }
      return { label: "", value: "" };
    })
    .filter((a) => a.label || a.value);
}

/** Editable grid of the key usage stats the verdicts rest on. Reads as a stat
    strip; in edit mode each label/value is click-to-edit with add/remove. */
function AssumptionStats({
  assumptions,
  onChange,
}: {
  assumptions: FreeTierAssumption[];
  onChange: (next: FreeTierAssumption[]) => void;
}) {
  const editing = useEditing();
  if (!editing && assumptions.length === 0) return null;

  const set = (i: number, p: Partial<FreeTierAssumption>) =>
    onChange(assumptions.map((a, idx) => (idx === i ? { ...a, ...p } : a)));
  const remove = (i: number) => onChange(assumptions.filter((_, idx) => idx !== i));
  const add = () => onChange([...assumptions, { label: "", value: "" }]);

  return (
    <div className="freetier-stats">
      <p className="prd-card__label">Key assumptions{editing ? " — edit a number, then re-check" : ""}</p>
      <div className="freetier-stats__grid">
        {assumptions.map((a, i) => (
          <div className="freetier-stat" key={i}>
            <div className="freetier-stat__valrow">
              <InlineText
                className="freetier-stat__value"
                value={a.value}
                onChange={(v) => set(i, { value: v })}
                placeholder="—"
                mono
              />
              {editing && (
                <button type="button" className="inline-remove" onClick={() => remove(i)} aria-label="Remove">
                  ×
                </button>
              )}
            </div>
            <InlineText
              className="freetier-stat__label"
              value={a.label}
              onChange={(v) => set(i, { label: v })}
              placeholder="Metric"
            />
          </div>
        ))}
      </div>
      {editing && (
        <button type="button" className="inline-add inline-add--block" onClick={add}>
          + Add stat
        </button>
      )}
    </div>
  );
}

function FreeTierFitBody({ content, patch }: SectionBodyProps) {
  const editing = useEditing();
  const [busy, setBusy] = useState(false);
  const analysis = content.freeTierAnalysis;
  const hasItems = (content.techStack?.length ?? 0) > 0 || (content.integrations?.length ?? 0) > 0;
  // The saved analysis is a cached snapshot. If a service it judged is no longer
  // in the stack (renamed/removed), the result is stale — don't show outdated
  // verdicts; prompt a re-check instead.
  const stale = freeTierStale(content, analysis);
  const assumptions = normalizeAssumptions(analysis?.assumptions);

  // Persist an edited stat into the cached analysis so it survives Save and is
  // sent back as authoritative on the next re-check.
  function patchAssumptions(next: FreeTierAssumption[]) {
    if (!analysis) return;
    patch({ freeTierAnalysis: { ...analysis, assumptions: next } });
  }

  function run() {
    if (busy) return;
    setBusy(true);
    analyzeFreeTierFitAction(content)
      .then((res) => {
        if (!("data" in res)) {
          toast.error(res.error);
          return;
        }
        patch({ freeTierAnalysis: res.data });
      })
      .catch(() => toast.error("Analysis failed."))
      .finally(() => setBusy(false));
  }

  if (!editing && (!analysis || stale)) {
    return (
      <p className="empty-note">
        {stale
          ? "This free-tier check is out of date — the stack changed since it ran. Re-check it in Edit mode."
          : "No free-tier analysis yet."}
      </p>
    );
  }

  return (
    <div className="card-stack">
      {editing && (
        <div className="freetier-scale">
          <p className="prd-card__label">Expected scale — optional, sharpens the estimate</p>
          <InlineText
            value={content.scaleAssumptions}
            onChange={(v) => patch({ scaleAssumptions: v })}
            placeholder="e.g. ~5,000 users in year 1, ~100 transactions/day"
            className="prd-card__desc"
            multiline
          />
        </div>
      )}

      {editing && (
        <div className="freetier-actions">
          <button type="button" className="prd-btn prd-btn--primary" onClick={run} disabled={busy || !hasItems}>
            {busy ? "Analyzing…" : analysis ? "Re-check with these assumptions" : "Check free-tier fit"}
          </button>
          <LookupPill on={busy} />
          {!hasItems && <span className="freetier-hint">Add tech stack or integrations first.</span>}
        </div>
      )}

      {stale && (
        <p className="estimate-banner">
          Out of date — your stack or integrations changed since this check. Re-check for an accurate result.
        </p>
      )}

      {analysis && !stale && (
        <>
          <div className="freetier-headline">
            <FitPill verdict={analysis.overallFitsFree} />
            {analysis.primaryLimitingFactor && (
              <span className="freetier-headline__factor">First to break free: {analysis.primaryLimitingFactor}</span>
            )}
            <CostTag value={priceRange(analysis.totalMonthlyCostIfPaid)} />
          </div>

          <AssumptionStats assumptions={assumptions} onChange={patchAssumptions} />

          {analysis.services.map((s, i) => (
            <div className="prd-card prd-card--freetier" key={i}>
              <div className="prd-card__head">
                <BrandLogo domain={domainForVerdict(content, s)} name={s.name} />
                <span className="prd-card__title">{s.name}</span>
                <FitPill verdict={s.fitsFree} />
                <CostTag value={s.recommendedPaidTier} />
              </div>
              {s.limitingFactor && (
                <>
                  <p className="prd-card__label">Limiting factor</p>
                  <p className="prd-card__desc">{s.limitingFactor}</p>
                </>
              )}
              {s.estimatedUsage && <p className="freetier-meta">Estimated usage — {s.estimatedUsage}</p>}
              {s.freeTierSummary && <p className="freetier-meta freetier-meta--muted">Free tier — {s.freeTierSummary}</p>}
            </div>
          ))}

          <p className="estimate-banner">
            Free-tier verdicts are AI estimates from published limits — verify each provider&apos;s current free tier before
            relying on this.
          </p>
          {analysis.analyzedAt && (
            <p className="freetier-meta freetier-meta--muted">Checked {formatChecked(analysis.analyzedAt)}</p>
          )}
        </>
      )}
    </div>
  );
}

function UxFlowsBody({ content, patch }: SectionBodyProps) {
  const flows = content.uxFlows ?? [];
  const h = listPatch(flows, patch, "uxFlows");
  const editing = useEditing();
  if (!editing && flows.length === 0) return <p className="empty-note">No UX flows yet.</p>;
  return (
    <div className="flow-stack">
      {flows.map((f, i) => {
        const steps = flowSteps(f);
        // Writing back always promotes the flow to the structured steps[] model.
        const setSteps = (next: string[]) => h.update(i, { steps: next, flow: undefined });
        return (
          <div className="flow-card" key={i}>
            <RemoveCard onClick={() => h.remove(i)} />
            <div className="flow-card__head">
              <InlineText
                value={f.role}
                onChange={(v) => h.update(i, { role: v })}
                placeholder="User type"
                className="flow-role"
              />
              {steps.length > 0 && (
                <span className="flow-count">
                  {steps.length} step{steps.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <ol className="flow-steps">
              {steps.map((s, j) => (
                <li className="flow-step" key={j}>
                  <div className="flow-step__rail" aria-hidden="true">
                    <span className="flow-step__node">{j + 1}</span>
                    <span className="flow-step__line" />
                  </div>
                  <div className="flow-step__body">
                    <InlineText
                      value={s}
                      onChange={(v) => setSteps(steps.map((x, xi) => (xi === j ? v : x)))}
                      placeholder="Describe this step"
                      className="flow-step__text"
                      multiline
                    />
                    {editing && (
                      <button
                        type="button"
                        className="inline-remove flow-step__remove"
                        onClick={() => setSteps(steps.filter((_, xi) => xi !== j))}
                        aria-label="Remove step"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            {editing && (
              <button type="button" className="flow-add" onClick={() => setSteps([...steps, ""])}>
                + step
              </button>
            )}
          </div>
        );
      })}
      <AddButton label="Add flow" onClick={() => h.add({ role: "", steps: [] })} />
    </div>
  );
}

function ConstraintsBody({ content, patch }: SectionBodyProps) {
  const cd = content.constraintsDetail ?? {};
  const editing = useEditing();
  const set = (p: Partial<typeof cd>) => patch({ constraintsDetail: { ...cd, ...p } });
  const FIELDS = [
    { key: "deadline" as const, label: "Must-have-by date", ph: "e.g. Live before Q3" },
    { key: "budget" as const, label: "Budget", ph: "e.g. Under $15k" },
    { key: "branding" as const, label: "Branding", ph: "e.g. Use existing brand colors/logo" },
    { key: "security" as const, label: "Security", ph: "e.g. SSO required, no PII off-platform" },
  ];
  const visible = editing ? FIELDS : FIELDS.filter((f) => cd[f.key]);
  if (!visible.length) return <p className="empty-note">No constraints recorded.</p>;
  return (
    <div className="constraint-grid">
      {visible.map((f) => (
        <div className="constraint-cell" key={f.key}>
          <p className="constraint-label">{f.label}</p>
          <InlineText
            value={cd[f.key]}
            onChange={(v) => set({ [f.key]: v })}
            placeholder={f.ph}
            className="constraint-value"
            multiline
          />
        </div>
      ))}
    </div>
  );
}

const MONTHS: Record<string, number> = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
  september: 8, sept: 8, sep: 8, october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11,
};

// Build a local-midnight Date, rejecting calendar overflow (e.g. Feb 31).
function buildDate(y: number, mo: number, d: number): Date | null {
  const dt = new Date(y, mo, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null;
  return dt;
}

// Parse a forgiving range of human date inputs into a local-midnight Date.
// Accepts "june 3", "jun 3rd", "3 june", "June 3, 2027", "6/3", "6-3-27",
// "06/03/2026", "2026-06-03". Year defaults to the current year unless given.
function parseFlexibleDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  let t = s.trim().toLowerCase();
  if (!t) return null;
  t = t.replace(/(\d+)(st|nd|rd|th)\b/g, "$1").replace(/,/g, " ").replace(/\s+/g, " ").trim();
  const curYear = new Date().getFullYear();
  const yr = (raw?: string) => (raw == null ? curYear : raw.length === 2 ? 2000 + +raw : +raw);

  let m: RegExpExecArray | null;
  // ISO: 2026-06-03
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) return buildDate(+m[1], +m[2] - 1, +m[3]);
  // Numeric: 6/3, 6-3, 6/3/26, 06/03/2026
  if ((m = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/.exec(t))) return buildDate(yr(m[3]), +m[1] - 1, +m[2]);
  // Month name first: "june 3", "jun 3 2027"
  if ((m = /^([a-z]+)\s+(\d{1,2})(?:\s+(\d{2,4}))?$/.exec(t)) && m[1] in MONTHS)
    return buildDate(yr(m[3]), MONTHS[m[1]], +m[2]);
  // Day first: "3 june", "3 june 2027"
  if ((m = /^(\d{1,2})\s+([a-z]+)(?:\s+(\d{2,4}))?$/.exec(t)) && m[2] in MONTHS)
    return buildDate(yr(m[3]), MONTHS[m[2]], +m[1]);
  return null;
}

// Format a Date as mm/dd/yyyy.
function fmtUS(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

/* DateField — a forgiving free-text date input in edit mode (type "June 3", "6/3",
   etc.), formatted mm/dd/yyyy text otherwise. On commit the input is parsed and
   onChange receives a normalized mm/dd/yyyy string (or "" when cleared); unparseable
   text reverts to the previous value. */
function DateField({
  value,
  onChange,
  className = "",
  placeholder = "e.g. June 3",
}: {
  value?: string | null;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const editing = useEditing();
  const [draft, setDraft] = useState(value ?? "");
  const [focused, setFocused] = useState(false);

  // Sync the draft from props only while not actively editing.
  useEffect(() => {
    if (!focused) setDraft(value ?? "");
  }, [value, focused]);

  if (!editing) {
    if (!value) return null;
    return <span className={className}>{value}</span>;
  }

  const commit = () => {
    setFocused(false);
    const t = draft.trim();
    if (t === "") {
      if (value) onChange("");
      return;
    }
    const d = parseFlexibleDate(t);
    if (d) onChange(fmtUS(d));
    else setDraft(value ?? ""); // unparseable — revert
  };

  return (
    <input
      type="text"
      className={"inline-input milestone-date-input " + className}
      value={draft}
      placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === "Escape") {
          setDraft(value ?? "");
          e.currentTarget.blur();
        }
      }}
    />
  );
}

// Spread milestones evenly from the project START (the system's current date) up to
// the deadline: the first milestone lands on today, the last (launch) on the deadline,
// and the rest at equal steps in between. If the deadline is today or earlier there's
// no forward window, so every milestone collapses onto the deadline.
function distributeMilestones(ms: PrdMilestone[], deadline: Date): PrdMilestone[] {
  const n = ms.length;
  if (n === 0) return ms;
  if (n === 1) return [{ ...ms[0], dueDate: fmtUS(deadline) }];

  const start = new Date(); // system current date = project start
  start.setHours(0, 0, 0, 0);
  const span = deadline.getTime() - start.getTime();
  if (span <= 0) return ms.map((m) => ({ ...m, dueDate: fmtUS(deadline) }));

  return ms.map((m, i) => {
    if (i === n - 1) return { ...m, dueDate: fmtUS(deadline) };
    const dt = new Date(start.getTime() + (span * i) / (n - 1));
    dt.setHours(0, 0, 0, 0);
    return { ...m, dueDate: fmtUS(dt) };
  });
}

function MilestonesBody({ content, patch }: SectionBodyProps) {
  const ms = content.milestoneList ?? [];
  const h = listPatch(ms, patch, "milestoneList");
  const editing = useEditing();
  const deadline = parseFlexibleDate(content.milestoneDueDate);

  // Setting / changing the overall deadline re-plans every milestone date to fit:
  // the last milestone (launch) lands on the deadline, the rest spread before it.
  const onDeadlineChange = (v: string) => {
    const d = parseFlexibleDate(v);
    if (!d) {
      patch({ milestoneDueDate: "", milestoneList: ms });
      return;
    }
    patch({ milestoneDueDate: fmtUS(d), milestoneList: distributeMilestones(ms, d) });
  };

  // Adding / removing a milestone re-fits the whole set when a deadline is set.
  const onAdd = () => {
    const next = [...ms, { label: "", dueDate: "" }];
    patch({ milestoneList: deadline ? distributeMilestones(next, deadline) : next });
  };
  const onRemove = (i: number) => {
    const next = ms.filter((_, idx) => idx !== i);
    patch({ milestoneList: deadline ? distributeMilestones(next, deadline) : next });
  };

  return (
    <div className="milestone-list">
      {(editing || content.milestoneDueDate) && (
        <div className="milestone-deadline">
          <span className="milestone-deadline-label">Due by</span>
          <span className="milestone-deadline-value">
            <DateField value={content.milestoneDueDate} onChange={onDeadlineChange} placeholder="mm/dd/yyyy" />
          </span>
        </div>
      )}
      {ms.map((m, i) => (
        <div className="milestone-row" key={i}>
          <span className="milestone-dot" aria-hidden="true"></span>
          <InlineText
            value={m.label}
            onChange={(v) => h.update(i, { label: v })}
            placeholder="Milestone"
            className="milestone-label"
          />
          <span className="milestone-due">
            <DateField value={m.dueDate} onChange={(v) => h.update(i, { dueDate: v })} placeholder="mm/dd/yyyy" />
          </span>
          <RemoveCard onClick={() => onRemove(i)} />
        </div>
      ))}
      <AddButton label="Add milestone" onClick={onAdd} />
    </div>
  );
}

// Simple list/text section bodies via factory.
const listBody = (
  key: keyof PrdContent,
  variant: "bullet" | "ordered" | "check" | "plain",
  addLabel: string,
  ph: string
) => {
  const Body = ({ content, patch }: SectionBodyProps): ReactNode => (
    <InlineList
      items={(content[key] as string[]) ?? []}
      onChange={(v) => patch({ [key]: v } as Partial<PrdContent>)}
      variant={variant}
      addLabel={addLabel}
      placeholder={ph}
    />
  );
  Body.displayName = `ListBody(${String(key)})`;
  return Body;
};

const textBody = (key: keyof PrdContent, ph: string) => {
  const Body = ({ content, patch }: SectionBodyProps): ReactNode => (
    <InlineText
      value={content[key] as string | undefined}
      onChange={(v) => patch({ [key]: v } as Partial<PrdContent>)}
      placeholder={ph}
      className="prose-text"
      multiline
      tag="p"
    />
  );
  Body.displayName = `TextBody(${String(key)})`;
  return Body;
};

// =====================================================================
//  Section registry — order, numbering, grouping
// =====================================================================
export interface SectionDef {
  id: string;
  num?: string;
  title: string;
  hint?: string;
  group: string;
  Body: ComponentType<SectionBodyProps>;
}

export const SECTIONS: SectionDef[] = [
  { id: "overview", num: "1", title: "Overview", hint: "The problem statement and a summary of the product.", group: "overview", Body: textBody("overview", "Describe the problem and product…") },
  { id: "goals", num: "2", title: "Goals", hint: "What the finished product looks like — the outcomes the client will have.", group: "overview", Body: listBody("goals", "bullet", "goal", "Goal") },
  { id: "successMetrics", title: "Success Metrics", hint: "How you'll tell adoption is healthy.", group: "overview", Body: listBody("successMetrics", "bullet", "metric", "Metric") },
  { id: "users", num: "3", title: "Who It's For", hint: "Each user type, their authorization level, and what they may do.", group: "overview", Body: UsersBody },
  { id: "coreUserFlow", title: "Core User Flow", hint: "One numbered, end-to-end walkthrough of the whole product.", group: "overview", Body: listBody("coreUserFlow", "ordered", "step", "Step") },

  { id: "features", num: "4", title: "Features", hint: "Prioritized capabilities needed for this to work.", group: "scope", Body: FeaturesBody },
  { id: "requirements", title: "Functional Requirements", hint: "Concrete things the system must do.", group: "scope", Body: listBody("requirements", "bullet", "requirement", "The system must…") },
  { id: "pagesScreens", title: "Pages & Screens", hint: "Every page/screen in this version and what it displays.", group: "scope", Body: PagesBody },
  { id: "successCriteria", title: "Success Criteria", hint: "Testable, binary acceptance checklist — each item is verifiably done or not.", group: "scope", Body: listBody("successCriteria", "check", "criterion", "Criterion") },
  { id: "nonFunctionalRequirements", num: "5", title: "Non-Functional Requirements", hint: "Non-feature qualities: performance, setup/hosting, security.", group: "scope", Body: listBody("nonFunctionalRequirements", "bullet", "requirement", "Quality") },
  { id: "scopeLater", num: "6", title: "Scope — Later", hint: "Features intentionally not in this version.", group: "scope", Body: listBody("scopeLater", "bullet", "item", "Deferred feature") },
  { id: "futureExpansion", title: "Future Expansion", hint: "Post-MVP upgrade opportunities the client could add later.", group: "scope", Body: listBody("futureExpansion", "bullet", "opportunity", "Opportunity") },

  { id: "dataModel", num: "7", title: "Data Model & Sources", hint: "What data moves in/out and where it comes from.", group: "build", Body: DataModelBody },
  { id: "integrations", num: "8", title: "Integrations & 3rd-Party Software", hint: "Recommended software and its monthly rate (not setup/dev cost).", group: "build", Body: IntegrationsBody },
  { id: "techStack", num: "9", title: "Tech Stack & Infrastructure", hint: "Languages and providers the build uses, with monthly cost.", group: "build", Body: TechStackBody },
  { id: "freeTierFit", title: "Free-Tier Fit", hint: "Whether the product can run on each service's free tier, and what forces the first paid upgrade.", group: "build", Body: FreeTierFitBody },
  { id: "uxFlows", num: "10", title: "UX Flows", hint: "Each user type's likely journey through the product.", group: "build", Body: UxFlowsBody },

  { id: "assumptions", num: "11", title: "Assumptions & Dependencies", hint: "What the client must provide within a reasonable timeframe.", group: "plan", Body: listBody("assumptions", "bullet", "assumption", "Assumption") },
  { id: "constraints", num: "12", title: "Constraints", hint: "Hard limits on the build.", group: "plan", Body: ConstraintsBody },
  { id: "risks", num: "13", title: "Risks", hint: "Things that could cause delay.", group: "plan", Body: listBody("risks", "bullet", "risk", "Risk") },
  { id: "openQuestions", title: "Open Questions", hint: "Unknowns to resolve with the client.", group: "plan", Body: listBody("openQuestions", "bullet", "question", "Question") },
  { id: "milestones", num: "14", title: "Milestones", hint: "What's due by each date.", group: "plan", Body: MilestonesBody },
];
