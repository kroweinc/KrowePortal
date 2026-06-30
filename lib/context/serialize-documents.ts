import "server-only";

import type {
  PrdContent,
  QuoteContent,
  ContractContent,
  PrdFeature,
  PrdUserRole,
  PrdUxFlow,
  QuoteModule,
  BriefLineItem,
} from "@/lib/types";

// ============================================================
// Render a PRD / quote / contract's structured content into one readable,
// bounded plain-text document. This is the text the Client Context Layer
// chunks + embeds when a document is auto-synced (see sync-document.ts), so
// keep sections stable and human-legible — it's what the RAG layer reads back.
// ============================================================

export type SyncDocKind = "prd" | "quote" | "contract";

/** Human label for a synced document's kind, used in titles and headings. */
export const DOC_KIND_LABEL: Record<SyncDocKind, string> = {
  prd: "PRD",
  quote: "Quote",
  contract: "Contract",
};

// A tiny line accumulator so each serializer reads as a flat list of sections.
class Lines {
  private out: string[] = [];

  heading(text: string): void {
    if (this.out.length) this.out.push("");
    this.out.push(text);
  }
  line(text: string): void {
    this.out.push(text);
  }
  /** A "Label:" section followed by bulleted strings; skipped when empty. */
  bullets(label: string, items?: (string | null | undefined)[]): void {
    const clean = (items ?? []).map((s) => (s ?? "").trim()).filter(Boolean);
    if (!clean.length) return;
    this.heading(`## ${label}`);
    for (const item of clean) this.line(`- ${item}`);
  }
  /** A "Label:" section with a single paragraph; skipped when blank. */
  para(label: string, text?: string | null): void {
    const t = (text ?? "").trim();
    if (!t) return;
    this.heading(`## ${label}`);
    this.line(t);
  }
  toString(): string {
    return this.out.join("\n").trim();
  }
}

function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "";
  return `$${Math.round(n).toLocaleString()}`;
}

function featureLine(f: PrdFeature): string {
  const priority = f.priority ? ` [${f.priority}]` : "";
  const desc = f.description ? ` — ${f.description}` : "";
  const details = f.details?.length ? ` (${f.details.join("; ")})` : "";
  return `${f.title}${priority}${desc}${details}`;
}

function userRoleLine(u: PrdUserRole): string {
  const auth = u.authLevel ? ` [${u.authLevel}]` : "";
  const desc = u.description ? ` — ${u.description}` : "";
  const perms = u.permissions?.length ? ` (can: ${u.permissions.join(", ")})` : "";
  return `${u.role}${auth}${desc}${perms}`;
}

function uxFlowLines(flow: PrdUxFlow): string[] {
  const steps = flow.steps?.length
    ? flow.steps
    : flow.flow
      ? flow.flow.split(/\n+/).map((s) => s.trim()).filter(Boolean)
      : [];
  return [`${flow.role}:`, ...steps.map((s, i) => `  ${i + 1}. ${s}`)];
}

function lineItemLines(items?: BriefLineItem[]): string[] {
  return (items ?? [])
    .filter((li) => li.label?.trim())
    .map((li) => `  • ${li.label} — ${money(li.amount)}${li.notes ? ` (${li.notes})` : ""}`);
}

function serializePrd(title: string, c: PrdContent): string {
  const l = new Lines();
  l.line(`# PRD — ${title}`);

  l.para("Overview", c.overview);
  l.bullets("Goals", c.goals);
  l.bullets("Success metrics", c.successMetrics);

  if (c.users?.length) l.bullets("Users", c.users.map(userRoleLine));
  else l.para("Target users", c.targetUsers);
  l.bullets("Core user flow", c.coreUserFlow);

  if (c.features?.length) l.bullets("Features", c.features.map(featureLine));
  l.bullets("Requirements", c.requirements);
  if (c.pagesScreens?.length) {
    l.bullets(
      "Pages / screens",
      c.pagesScreens.map(
        (p) => `${p.name}${p.description ? ` — ${p.description}` : ""}${p.displays?.length ? ` (shows: ${p.displays.join(", ")})` : ""}`
      )
    );
  }
  l.bullets("Success criteria", c.successCriteria);
  l.bullets("Non-functional requirements", c.nonFunctionalRequirements);

  if (c.dataModel?.length) {
    l.bullets(
      "Data model & sources",
      c.dataModel.map((d) => `${d.data}${d.direction ? ` [${d.direction}]` : ""}${d.source ? ` from ${d.source}` : ""}`)
    );
  }
  if (c.integrations?.length) {
    l.bullets(
      "Integrations",
      c.integrations.map((i) => `${i.name}${i.purpose ? ` — ${i.purpose}` : ""}${i.monthlyCost ? ` (${i.monthlyCost}/mo)` : ""}`)
    );
  }
  if (c.techStack?.length) {
    l.bullets(
      "Tech stack",
      c.techStack.map((s) => `${s.name}${s.layer ? ` [${s.layer}]` : ""}${s.provider ? ` via ${s.provider}` : ""}`)
    );
  }
  if (c.uxFlows?.length) {
    l.heading("## UX flows");
    for (const f of c.uxFlows) for (const ln of uxFlowLines(f)) l.line(ln);
  }

  l.bullets("Assumptions (client provides)", c.assumptions);
  if (c.constraintsDetail) {
    const cd = c.constraintsDetail;
    l.bullets(
      "Constraints",
      [
        cd.deadline && `Deadline: ${cd.deadline}`,
        cd.budget && `Budget: ${cd.budget}`,
        cd.branding && `Branding: ${cd.branding}`,
        cd.security && `Security: ${cd.security}`,
      ].filter(Boolean) as string[]
    );
  } else {
    l.bullets("Constraints", c.constraints);
  }
  l.bullets("Risks", c.risks);
  l.bullets("Open questions", c.openQuestions);
  l.bullets("Scope (later)", c.scopeLater);
  l.bullets("Future expansion", c.futureExpansion);

  if (c.milestoneList?.length) {
    l.bullets("Milestones", c.milestoneList.map((m) => `${m.label}${m.dueDate ? ` — due ${m.dueDate}` : ""}`));
  } else {
    l.para("Milestones", c.milestones);
  }

  return l.toString();
}

function serializeQuote(title: string, c: QuoteContent): string {
  const l = new Lines();
  l.line(`# Quote — ${title}`);
  if (c.companyName || c.clientName) l.line(`For: ${[c.companyName, c.clientName].filter(Boolean).join(" / ")}`);
  if (c.productSubtitle) l.line(`Product: ${c.productSubtitle}`);

  l.para("Scope summary", c.scopeSummary);

  if (c.modules?.length) {
    l.heading("## Modules");
    for (const m of c.modules as QuoteModule[]) {
      l.line(`- ${m.title}${m.cost ? ` — ${money(m.cost)}` : ""}${m.purpose ? `: ${m.purpose}` : ""}`);
      if (m.description) l.line(`  ${m.description}`);
      for (const ln of lineItemLines(m.lineItems)) l.line(ln);
    }
  }

  if (c.extraCosts?.length) {
    l.bullets(
      "Additional costs",
      c.extraCosts.map((e) => `${e.label} [${e.kind}] — ${money(e.amount)}${e.notes ? ` (${e.notes})` : ""}`)
    );
  }
  if (c.designSystem?.length) {
    l.bullets(
      "Design system",
      c.designSystem.map((d) => `${d.component}: ${d.included ? "included" : "not included"}${d.notes ? ` — ${d.notes}` : ""}`)
    );
  }
  if (c.paymentMilestones?.length) {
    l.bullets(
      "Payment structure",
      c.paymentMilestones.map((p) => `${p.label} — ${money(p.amount)}${p.percent != null ? ` (${p.percent}%)` : ""}`)
    );
  }
  l.bullets("Why this price is justified", c.justification);
  l.bullets("Not included unless separately quoted", c.scopeProtection);

  if (c.totals) {
    l.bullets(
      "Totals",
      [
        c.totals.grand != null && `Total project quote: ${money(c.totals.grand)}`,
        c.totals.modulesTotal != null && `Modules: ${money(c.totals.modulesTotal)}`,
        c.totals.extrasTotal != null && `Extras: ${money(c.totals.extrasTotal)}`,
      ].filter(Boolean) as string[]
    );
  }
  if (c.validityDays) l.line(`Valid for ${c.validityDays} days.`);

  return l.toString();
}

function serializeContract(title: string, c: ContractContent): string {
  const l = new Lines();
  l.line(`# Contract — ${title}`);
  if (c.parties?.provider || c.parties?.client) {
    l.line(`Between ${c.parties?.provider ?? "Provider"} and ${c.parties?.client ?? "Client"}.`);
  }
  if (c.effectiveDate) l.line(`Effective date: ${c.effectiveDate}`);

  l.para("Scope of services", c.scopeOfServices);
  l.bullets("Deliverables", c.deliverables);
  l.para("Fees", c.fees);
  l.para("Payment terms", c.paymentTerms);
  l.para("Timeline", c.timeline);
  l.para("IP ownership", c.ipOwnership);
  l.para("Confidentiality", c.confidentiality);
  l.para("Warranties", c.warranties);
  l.para("Liability", c.liability);
  l.para("Termination", c.termination);
  l.para("Change management", c.changeManagement);
  l.para("Governing law", c.governingLaw);
  l.bullets("Additional terms", c.additionalTerms);

  if (c.scopeItems?.length) {
    l.bullets(
      "Exhibit A — Scope of work",
      c.scopeItems.map((s) => `${s.title}${s.purpose ? ` — ${s.purpose}` : ""}${s.cost != null ? ` (${money(s.cost)})` : ""}`)
    );
  }
  if (c.paymentSchedule?.length) {
    l.bullets(
      "Exhibit B — Payment schedule",
      c.paymentSchedule.map((p) => `${p.label} — ${money(p.amount)}${p.percent != null ? ` (${p.percent}%)` : ""}`)
    );
  }
  if (c.quoteTotal != null) l.line(`Quote total: ${money(c.quoteTotal)}`);

  return l.toString();
}

/** Serialize a synced document's content to the text the RAG layer embeds. */
export function serializeDocumentForContext(
  kind: SyncDocKind,
  title: string,
  content: PrdContent | QuoteContent | ContractContent
): string {
  switch (kind) {
    case "prd":
      return serializePrd(title, content as PrdContent);
    case "quote":
      return serializeQuote(title, content as QuoteContent);
    case "contract":
      return serializeContract(title, content as ContractContent);
  }
}
