import "server-only";

import { Lines, money, lineItemLines } from "@/lib/context/serialize-documents";
import { MAX_SOP_CHARS } from "@/lib/attachments-constants";
import type {
  Brief,
  ChangeOrder,
  EngagementAgreement,
  Deliverable,
  InfraRecommendation,
  ContextMaterial,
  Task,
  Subtask,
  Milestone,
  BuilderAvailability,
  ProjectMaterial,
  ProjectSopTranscript,
  TaskAttachment,
} from "@/lib/types";

// ============================================================
// Render each engagement entity (briefs, change orders, the operating
// agreement, deliverables, infra recommendations, tasks, milestones, builder
// availability) into one readable, bounded plain-text document. This is the
// text the Client Context Layer chunks + embeds when the entity is auto-synced
// (see sync-entity.ts), so keep sections stable and human-legible — it's what
// the RAG layer reads back.
//
// Every serializer returns "" when there's nothing substantive beyond its
// heading line, so the sync seam never creates (or, on update, keeps) an empty
// mirror — mirrors serialize-documents / serialize-profile behaviour.
// ============================================================

/** True when the rendered text carries content past its single heading line. */
function hasBody(text: string): string {
  return text.split("\n").filter((l) => l.trim()).length > 1 ? text : "";
}

/** Compact estimate label from a task's exact / range hour fields. */
function estimateLabel(t: Task): string {
  if (t.builder_estimate_low_hours != null || t.builder_estimate_high_hours != null) {
    const lo = t.builder_estimate_low_hours;
    const hi = t.builder_estimate_high_hours;
    if (lo != null && hi != null) return `${lo}–${hi} hrs`;
    if (lo != null) return `≥${lo} hrs`;
    if (hi != null) return `≤${hi} hrs`;
  }
  if (t.builder_estimate_hours != null) return `${t.builder_estimate_hours} hrs`;
  return "";
}

export function serializeBrief(b: Pick<Brief, "title" | "status" | "content" | "sop_intake">): string {
  const l = new Lines();
  l.line(`# Brief — ${b.title}`);
  l.line(`Status: ${b.status}`);

  const c = b.content ?? {};
  l.para("Summary", c.summary);
  l.para("Proposed solution", c.proposedSolution);
  if (c.deliverables?.length) {
    l.bullets(
      "Deliverables",
      c.deliverables.map((d) => `${d.title}${d.acceptanceCriteria ? ` — ${d.acceptanceCriteria}` : ""}`)
    );
  }
  if (c.preWork?.length) {
    l.heading("## Pre-work");
    for (const ln of lineItemLines(c.preWork)) l.line(ln);
  }
  if (c.projectLineItems?.length) {
    l.heading("## Project line items");
    for (const ln of lineItemLines(c.projectLineItems)) l.line(ln);
  }
  l.bullets("Out of scope", c.outOfScope);
  l.bullets("Assumptions", c.assumptions);
  l.para("Timeline", c.timeline);
  l.para("Payment terms", c.paymentTerms);
  if (c.hourlyRate) l.line(`Hourly rate: ${money(c.hourlyRate)}`);
  if (c.totals) {
    l.bullets(
      "Totals",
      [
        c.totals.preWork != null && `Pre-work: ${money(c.totals.preWork)}`,
        c.totals.project != null && `Project: ${money(c.totals.project)}`,
        c.totals.grand != null && `Grand total: ${money(c.totals.grand)}`,
      ].filter(Boolean) as string[]
    );
  }

  // Discovery-call SOP intake — the richest narrative the brief carries.
  const s = b.sop_intake ?? {};
  l.para("Business context", s.businessContext);
  l.para("Their ideas", s.theirIdeas);
  l.para("Why now", s.whyNow);
  l.para("Problem / current state", s.problemCurrentState);
  l.para("Desired outcome", s.desiredOutcome);
  l.para("Scope", s.scope);
  l.para("Audience & brand", s.audienceBrand);
  l.para("Stack / access / ownership", s.stackAccessOwnership);
  l.para("Stakeholders", s.stakeholders);
  l.para("Timeline & constraints", s.timelineConstraints);
  l.para("Budget signal", s.budgetSignal);
  l.bullets("Risk flags", s.riskFlags);

  return hasBody(l.toString());
}

export function serializeChangeOrder(co: ChangeOrder): string {
  const l = new Lines();
  l.line(`# Change order — ${co.title}`);
  l.line(`Status: ${co.status}`);

  const c = co.content ?? {};
  l.para("Summary", c.summary);
  if (c.lineItems?.length) {
    l.heading("## Line items");
    for (const ln of lineItemLines(c.lineItems)) l.line(ln);
  }
  if (c.hourlyRate) l.line(`Hourly rate: ${money(c.hourlyRate)}`);
  if (c.total != null) l.line(`Total: ${money(c.total)}`);
  if (co.delta_amount != null) l.line(`Delta amount: ${money(co.delta_amount)}`);
  if (co.signed_by_name) {
    l.line(`Signed by ${co.signed_by_name}${co.signed_at ? ` on ${co.signed_at.slice(0, 10)}` : ""}`);
  }
  if (co.rejection_note) l.para("Rejection note", co.rejection_note);

  return hasBody(l.toString());
}

export function serializeAgreement(a: EngagementAgreement): string {
  const l = new Lines();
  l.line(`# Operating agreement`);
  if (a.priority_profile?.length) l.line(`Priorities (ranked): ${a.priority_profile.join(" > ")}`);
  l.line(
    `Billing: ${a.billing_mode}` +
      (a.monthly_recurring != null ? ` · ${money(a.monthly_recurring)}/mo recurring` : "")
  );
  l.line(`Warranty: ${a.warranty_days} days · Urgency multiplier: ${a.urgency_multiplier}×`);
  l.para("Review cadence", a.review_cadence);
  l.para("Meeting schedule", a.meeting_schedule);
  if (a.comm_channels?.length) {
    l.bullets(
      "Communication channels",
      a.comm_channels.map((c) => `${c.channel}${c.purpose ? ` — ${c.purpose}` : ""}`)
    );
  }
  if (a.decision_rights?.length) {
    l.bullets(
      "Decision rights",
      a.decision_rights.map(
        (d) => `${d.decision}: signer ${d.signer}, reviewer ${d.reviewer}, informed ${d.informed}`
      )
    );
  }
  return hasBody(l.toString());
}

export interface TaskBuildPromptRow {
  variant: string;
  prompt: string;
  notes: string | null;
}

export interface TaskCommitRow {
  commit_sha: string;
  commit_message: string | null;
}

export interface TaskContextInput {
  task: Task;
  milestoneTitle: string | null;
  subtasks: Subtask[];
  buildPrompts: TaskBuildPromptRow[];
  commits: TaskCommitRow[];
}

export function serializeTask(input: TaskContextInput): string {
  const { task: t, milestoneTitle, subtasks, buildPrompts, commits } = input;
  const l = new Lines();
  l.line(`# Task — ${t.title}`);
  l.line(`Status: ${t.status} · Priority: ${t.priority} · Source: ${t.source}`);
  if (milestoneTitle) l.line(`Milestone: ${milestoneTitle}`);
  const est = estimateLabel(t);
  if (est) l.line(`Estimate: ${est}`);

  l.para("Description", t.description);
  l.para("Completion note", t.completion_note);

  if (subtasks.length) {
    l.bullets(
      "Subtasks",
      subtasks.map((s) => `[${s.completed ? "x" : " "}] ${s.title}`)
    );
  }
  if (commits.length) {
    l.bullets(
      "Commits",
      commits.map((c) => `${c.commit_sha.slice(0, 7)} ${(c.commit_message ?? "").split("\n")[0]}`)
    );
  }
  if (buildPrompts.length) {
    l.heading("## Build prompts");
    for (const bp of buildPrompts) {
      l.line(`### ${bp.variant}`);
      if (bp.notes?.trim()) l.line(bp.notes.trim());
      l.line(bp.prompt);
    }
  }

  return hasBody(l.toString());
}

export function serializeMilestone(m: Milestone): string {
  const l = new Lines();
  l.line(`# Milestone — ${m.title}`);
  l.line(`Status: ${m.status}${m.source_amount != null ? ` · Value: ${money(m.source_amount)}` : ""}`);
  l.para("Description", m.description);
  return hasBody(l.toString());
}

export function serializeDeliverable(d: Deliverable, milestoneTitle: string | null): string {
  const l = new Lines();
  l.line(`# Deliverable — ${d.title}`);
  if (milestoneTitle) l.line(`Milestone: ${milestoneTitle}`);
  if (d.url) l.line(`Link: ${d.url}`);
  l.para("Details", d.body);
  return hasBody(l.toString());
}

export function serializeInfra(r: InfraRecommendation): string {
  const l = new Lines();
  l.line(`# Infrastructure — ${r.item}`);
  if (r.category) l.line(`Category: ${r.category}`);
  const cost = r.operator_override_monthly ?? r.recommended_monthly;
  if (cost != null) {
    l.line(`Monthly cost: ${money(cost)}${r.operator_override_monthly != null ? " (operator override)" : ""}`);
  }
  l.para("Operator note", r.operator_override);
  l.line(`Accepted: ${r.accepted ? "yes" : "no"}`);
  return hasBody(l.toString());
}

export function serializeAvailability(a: BuilderAvailability): string {
  const l = new Lines();
  l.line(`# Builder availability`);
  l.line(`Status: ${a.status}${a.weekly_hours != null ? ` · ~${a.weekly_hours} hrs/week` : ""}`);
  l.para("Note", a.note);
  return hasBody(l.toString());
}

export interface TaskAttachmentContextInput {
  attachment: Pick<TaskAttachment, "attachment_type" | "file_name" | "url" | "is_deliverable">;
  taskTitle: string | null;
  /** Already-resolved text: text_content / fetched link / extracted file. */
  body: string;
}

// Only attachments whose content is resolvable become a mirror. A non-extractable
// file (image, zip) or a failed link fetch yields an empty body → "" → no
// context_item (the attachment still gets a graph node from its raw row). This is
// the seam that lets "every attachment is a node, only extractable ones embed".
export function serializeTaskAttachment(input: TaskAttachmentContextInput): string {
  const text = input.body.slice(0, MAX_SOP_CHARS).trim();
  if (!text) return "";
  const { attachment: a, taskTitle } = input;
  const l = new Lines();
  l.line(`# Attachment — ${a.file_name}`);
  if (taskTitle) l.line(`Task: ${taskTitle}`);
  l.line(`Type: ${a.attachment_type}${a.is_deliverable ? " · deliverable" : ""}`);
  if (a.url) l.line(`Link: ${a.url}`);
  l.heading("## Content");
  l.line(text);
  return l.toString();
}

export function serializeContextMaterial(m: ContextMaterial): string {
  const l = new Lines();
  l.line(`# Material — ${m.title}`);
  if (m.category) l.line(`Category: ${m.category}`);
  if (m.url) l.line(`Link: ${m.url}`);
  l.para("Notes", m.body);
  return hasBody(l.toString());
}

// ---- Project-scoped (synced into the engagement once the project is linked) --

export function serializeProjectMaterial(m: ProjectMaterial): string {
  const l = new Lines();
  l.line(`# Project material — ${m.label ?? m.file_name ?? "Material"}`);
  l.line(`Type: ${m.material_type}`);
  if (m.url) l.line(`Link: ${m.url}`);
  if (m.file_name) l.line(`File: ${m.file_name}`);
  return hasBody(l.toString());
}

export function serializeProjectSop(t: ProjectSopTranscript): string {
  const l = new Lines();
  l.line(`# Discovery transcript — ${t.label ?? "Transcript"}`);
  const body = (t.content ?? "").slice(0, MAX_SOP_CHARS).trim();
  if (body) {
    l.heading("## Transcript");
    l.line(body);
  }
  return hasBody(l.toString());
}

// ---- Codebase (one consolidated item per engagement, from the linked repo) ---

/** Stringify a project_profiles features/services jsonb entry (string or object). */
function profileItemLabel(item: unknown): string {
  if (typeof item === "string") return item;
  if (item && typeof item === "object") {
    const o = item as Record<string, unknown>;
    const name = (o.name ?? o.title ?? o.label ?? o.service) as string | undefined;
    const desc = (o.description ?? o.purpose ?? o.detail) as string | undefined;
    if (name) return desc ? `${name} — ${desc}` : name;
    return JSON.stringify(o);
  }
  return String(item);
}

export interface CodebaseContextInput {
  repoFullName: string;
  profile: {
    summary: string | null;
    audience: string | null;
    current_state: string | null;
    state_rationale: string | null;
    features: unknown[] | null;
    services: unknown[] | null;
  } | null;
  branches: { branch_name: string; purpose: string }[];
  commits: { commit_sha: string; summary: string; category: string | null }[];
}

export function serializeCodebase(input: CodebaseContextInput): string {
  const l = new Lines();
  l.line(`# Codebase — ${input.repoFullName}`);

  const p = input.profile;
  if (p) {
    l.para("Summary", p.summary);
    l.para("Audience", p.audience);
    if (p.current_state) {
      l.line(`State: ${p.current_state}${p.state_rationale ? ` — ${p.state_rationale}` : ""}`);
    }
    if (p.features?.length) l.bullets("Features", p.features.map(profileItemLabel));
    if (p.services?.length) l.bullets("Services", p.services.map(profileItemLabel));
  }
  if (input.branches.length) {
    l.bullets("Branches", input.branches.map((b) => `${b.branch_name} — ${b.purpose}`));
  }
  if (input.commits.length) {
    l.bullets(
      "Recent commits",
      input.commits.map(
        (c) => `${c.commit_sha.slice(0, 7)}${c.category ? ` [${c.category}]` : ""} ${c.summary}`
      )
    );
  }

  return hasBody(l.toString());
}
