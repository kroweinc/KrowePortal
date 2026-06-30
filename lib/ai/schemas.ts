import { z } from "zod";
import { TASK_TAGS } from "@/lib/types";

const Question = z
  .object({
    id: z.string(),
    text: z.string().min(3).max(300),
    // Choice options, ranked most→least likely. Empty for "date" and "text"
    // questions, where the builder types a value instead of picking an option.
    options: z.array(z.string().min(1).max(80)).max(5).default([]),
    // "choice" (default) renders selectable options; "date" renders an MM/DD/YYYY
    // input; "text" renders an open-ended textarea (e.g. the "what's your idea?"
    // opener of the no-scope intake). Lets the AI mark a question as free-form
    // entry rather than a pick-list.
    inputType: z.enum(["choice", "date", "text"]).default("choice"),
    // When true, the builder may select more than one option. Defaults to single-select.
    multiSelect: z.boolean().default(false),
    // The exact text of the option the AI judges best — MUST equal one of `options`.
    // Surfaced in the UI as a "Recommended" badge and pre-selected for the builder.
    recommended: z.string().min(1).max(80).optional(),
    // One short, plain-language sentence on WHY it's the best default, for a
    // non-technical builder. Interview-time guidance only; not persisted.
    recommendation: z.string().min(1).max(280).optional(),
    // When true, the wizard offers a "Skip" affordance so the builder can move on
    // without answering (e.g. an optional catch-all gap-filler). Not surfaced to
    // the model in any prompt — only the server-built fallback round sets it.
    skippable: z.boolean().optional(),
  })
  // Only choice questions need a real pick-list; date/text questions are free-form.
  .superRefine((q, ctx) => {
    if (q.inputType === "choice" && q.options.length < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message: "choice questions need at least 3 options",
      });
    }
  });

// Subtasks are intentionally NOT part of a generated task draft. The new-task AI
// flow drafts title/description/priority plus the Linear-style classification;
// subtasks are generated SEPARATELY, on demand, from the task sidebar (see
// SubtasksResult below and lib/ai/generate-subtasks.ts).
export const TaskDraft = z.object({
  title: z.string().min(3).max(300),
  description: z.string().min(20).max(2000),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  // Classification folded into the draft (same taxonomy as TaskClassifyResult) so
  // an AI-generated task carries its type/area on creation — no deferred classifier
  // round-trip and no fill-in delay. `type` defaults to "change" so a rare omission
  // degrades to the catch-all instead of failing the whole generation.
  type: z.enum(["feature", "bug", "change"]).default("change"),
  tags: z.array(z.enum(TASK_TAGS)).max(1).default([]),
});

export const TaskGenerationResult = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("questions"), items: z.array(Question).min(2).max(4) }),
  z.object({ kind: z.literal("task"), item: TaskDraft }),
]);

export const TaskOnlyResult = z.object({
  kind: z.literal("task"),
  item: TaskDraft,
});

// On-demand subtask breakdown. The "Generate" button in the task sidebar turns
// a task (+ its linked repo) into a flat, ordered list of concrete subtasks.
// Titles only — subtasks carry no AI estimate, matching manually-added ones.
export const SubtaskDraft = z.object({
  title: z.string().min(3).max(200),
});

export const SubtasksResult = z.object({
  items: z.array(SubtaskDraft).min(1).max(12),
});

export const TaskEstimateResult = z
  .object({
    hoursLow: z.number().min(0.1).max(2000),
    hoursHigh: z.number().min(0.1).max(2000),
  })
  .refine((d) => d.hoursHigh >= d.hoursLow, {
    message: "hoursHigh must be >= hoursLow",
    path: ["hoursHigh"],
  });

// Linear-style classification: the single change type plus exactly ONE area
// label drawn from the fixed TASK_TAGS taxonomy (e.g. "auth", "ui"). Kept as an
// array (capped at 1) so the tasks.tags text[] column and TaskTags renderer stay
// unchanged. Persisted by classifyAndSaveTask onto tasks.type / tasks.tags.
export const TaskClassifyResult = z.object({
  type: z.enum(["feature", "bug", "change"]),
  tags: z.array(z.enum(TASK_TAGS)).max(1).default([]),
});

export const ProjectProfileResult = z.object({
  summary: z.string().min(20).max(600),
  audience: z.string().min(10).max(400),
  features: z.array(z.string().min(3).max(200)).min(1).max(10),
  currentState: z.enum(["early", "active", "mature", "dormant"]),
  stateRationale: z.string().min(10).max(300),
  services: z
    .array(
      z.object({
        name: z.string().min(1).max(40),
        purpose: z.string().min(3).max(80),
      })
    )
    .max(15)
    .default([]),
});

export const SimplifiedSubtask = z.object({
  id: z.string(),
  simpleTitle: z.string().min(1).max(300),
});

export const SimplifiedTask = z.object({
  id: z.string(),
  simpleTitle: z.string().min(1).max(300),
  simpleDescription: z.string().max(2000).nullable(),
  simpleSubtasks: z.array(SimplifiedSubtask).default([]),
});

export const SimplifyTasksResult = z.object({
  items: z.array(SimplifiedTask),
});

// ── PRD ──────────────────────────────────────────────────────────────────
const PrdFeatureSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullish(),
  priority: z.enum(["must", "should", "could"]).nullish(),
  // Enumerated specifics for this feature: every form field, email's contents,
  // table column, status value, admin action — the mini-spec.
  details: z.array(z.string().min(1).max(400)).max(20).default([]),
  // Illustrative sample values, understood as examples (e.g. "REF-1024",
  // "Home insurance"). Never committed facts.
  examples: z.array(z.string().min(1).max(200)).max(20).default([]),
});

const PrdUserRoleSchema = z.object({
  role: z.string().min(1).max(120),
  // One–two sentence narrative for this named user sub-group.
  description: z.string().max(600).nullish(),
  authLevel: z.string().max(80).nullish(),
  permissions: z.array(z.string().min(1).max(300)).max(20).default([]),
});

const PrdDataSourceSchema = z.object({
  data: z.string().min(1).max(200),
  direction: z.enum(["import", "export", "both"]).nullish(),
  source: z.string().max(300).nullish(),
});

const PrdIntegrationSchema = z.object({
  name: z.string().min(1).max(120),
  purpose: z.string().max(300).nullish(),
  monthlyCost: z.string().max(80).nullish(),
  estimated: z.boolean().optional(),
  // Official site host (e.g. "stripe.com") used to fetch the brand logo.
  domain: z.string().max(120).nullish(),
});

const PrdStackItemSchema = z.object({
  name: z.string().min(1).max(120),
  category: z.string().max(80).nullish(),
  provider: z.string().max(120).nullish(),
  // Which architectural layer this item belongs to, so the view can group it.
  layer: z.enum(["frontend", "backend", "database", "email", "hosting", "other"]).nullish(),
  // What this layer covers (e.g. "Public referral form", "Stores submissions").
  includes: z.array(z.string().min(1).max(200)).max(12).default([]),
  monthlyCost: z.string().max(80).nullish(),
  estimated: z.boolean().optional(),
  // Official site host (e.g. "vercel.com") used to fetch the brand logo.
  domain: z.string().max(120).nullish(),
});

const PrdPageSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(600).nullish(),
  // What the page shows or lets the user do.
  displays: z.array(z.string().min(1).max(300)).max(20).default([]),
});

const PrdUxFlowSchema = z.object({
  role: z.string().min(1).max(120),
  flow: z.string().min(1).max(1200).optional(),
  steps: z.array(z.string().min(1).max(400)).max(15).optional(),
});

const PrdConstraintsSchema = z.object({
  deadline: z.string().max(300).nullish(),
  budget: z.string().max(300).nullish(),
  branding: z.string().max(300).nullish(),
  security: z.string().max(300).nullish(),
});

const PrdMilestoneSchema = z.object({
  label: z.string().min(1).max(200),
  dueDate: z.string().max(80).nullish(),
});

// ── Free-Tier Fit ──────────────────────────────────────────────────────────
// Per-service verdict: can THIS product run on the provider's free tier, and
// what dimension forces an upgrade. Every figure is a published-rate ESTIMATE
// (estimated defaults true) the builder must verify.
const FreeTierServiceVerdict = z.object({
  name: z.string().min(1).max(120),
  provider: z.string().max(120).nullish(),
  // false ⇒ the provider has no free tier at all (fitsFree must then be "no").
  hasFreeTier: z.boolean(),
  fitsFree: z.enum(["yes", "risky", "no"]),
  // The free-tier limits the verdict was reasoned against (audit trail).
  freeTierSummary: z.string().max(400).nullish(),
  // Inferred usage for this product on the limiting dimension.
  estimatedUsage: z.string().max(300).nullish(),
  // The single dimension that forces / threatens an upgrade off free.
  limitingFactor: z.string().max(200).nullish(),
  // Next tier up + its rate, e.g. "Pro — ~$25/mo".
  recommendedPaidTier: z.string().max(160).nullish(),
  estimated: z.boolean().default(true),
});

// A single usage figure the verdicts rest on, surfaced as an editable stat
// (e.g. { label: "Monthly active users", value: "~5,000" }). The builder can
// correct any value and re-run; on re-run these are treated as authoritative.
const FreeTierAssumption = z.object({
  label: z.string().min(1).max(120),
  value: z.string().min(1).max(80),
});

export const FreeTierAnalysisResult = z.object({
  // Worst case across all services.
  overallFitsFree: z.enum(["yes", "risky", "no"]),
  // The binding constraint — first/most-likely service+dimension to break free.
  primaryLimitingFactor: z.string().max(240).nullish(),
  // Minimum monthly cost if the non-fitting services move to their paid tiers.
  totalMonthlyCostIfPaid: z.string().max(160).nullish(),
  // The inferred-usage stats the verdicts rest on — the builder's editable knobs.
  assumptions: z.array(FreeTierAssumption).max(15).default([]),
  services: z.array(FreeTierServiceVerdict).max(30).default([]),
  // ISO stamp set by the server action (not the model).
  analyzedAt: z.string().max(40).nullish(),
  // Normalized stack+integration names present when this ran (set by the action,
  // not the model). Used to detect a genuinely changed stack — never the concrete
  // providers the model inferred (e.g. "Managed hosting" → Vercel). Absent on legacy rows.
  analyzedStack: z.array(z.string().max(120)).max(60).nullish(),
});

export const PrdContentSchema = z.object({
  overview: z.string().max(3000).optional(),
  goals: z.array(z.string().min(1).max(300)).max(15).default([]),
  successMetrics: z.array(z.string().min(1).max(300)).max(15).default([]),
  users: z.array(PrdUserRoleSchema).max(15).default([]),
  targetUsers: z.string().max(1200).optional(),
  // One numbered end-to-end walkthrough of the whole product (unnumbered strings).
  coreUserFlow: z.array(z.string().min(1).max(400)).max(20).default([]),
  features: z.array(PrdFeatureSchema).max(30).default([]),
  requirements: z.array(z.string().min(1).max(400)).max(40).default([]),
  // Every page/screen in this version and what it displays.
  pagesScreens: z.array(PrdPageSchema).max(20).default([]),
  // Testable, binary acceptance checklist (distinct from successMetrics).
  successCriteria: z.array(z.string().min(1).max(400)).max(25).default([]),
  nonFunctionalRequirements: z.array(z.string().min(1).max(400)).max(30).default([]),
  scopeLater: z.array(z.string().min(1).max(300)).max(30).default([]),
  // Post-MVP upgrade opportunities (distinct from scopeLater).
  futureExpansion: z.array(z.string().min(1).max(300)).max(30).default([]),
  nonGoals: z.array(z.string().min(1).max(300)).max(30).default([]),
  dataModel: z.array(PrdDataSourceSchema).max(30).default([]),
  integrations: z.array(PrdIntegrationSchema).max(30).default([]),
  techStack: z.array(PrdStackItemSchema).max(30).default([]),
  uxFlows: z.array(PrdUxFlowSchema).max(20).default([]),
  assumptions: z.array(z.string().min(1).max(400)).max(30).default([]),
  constraintsDetail: PrdConstraintsSchema.optional(),
  constraints: z.array(z.string().min(1).max(300)).max(30).default([]),
  risks: z.array(z.string().min(1).max(400)).max(30).default([]),
  openQuestions: z.array(z.string().min(1).max(400)).max(30).default([]),
  milestoneDueDate: z.string().max(80).nullish(),
  milestoneList: z.array(PrdMilestoneSchema).max(30).default([]),
  milestones: z.string().max(2000).optional(),
  // Builder's optional usage hint to sharpen the free-tier analysis.
  scaleAssumptions: z.string().max(1000).optional(),
  // Cached free-tier fit analysis (builder-only "Free-Tier Fit" section).
  freeTierAnalysis: FreeTierAnalysisResult.optional(),
});

// While the wizard may still ask more questions: questions OR a finished PRD.
export const PrdGenerationResult = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("questions"), items: z.array(Question).min(2).max(5) }),
  z.object({
    kind: z.literal("prd"),
    content: PrdContentSchema,
    // Deep "no-context" flow only: a synthesized business-context narrative the
    // server writes back to projects.context for reuse. Absent in standard flows.
    contextSummary: z.string().max(2000).optional(),
  }),
]);

// Forced on the final round: the model must return a PRD, not more questions.
export const PrdFinalResult = z.object({
  kind: z.literal("prd"),
  content: PrdContentSchema,
  contextSummary: z.string().max(2000).optional(),
});

// ── PRD section refine ───────────────────────────────────────────────────────
// A partial PRD: the refine flow only ever touches one section's keys (the
// server whitelists to those keys), so every field is optional here.
export const PrdSectionPatchSchema = PrdContentSchema.partial();

// While the refine wizard may still ask: clarifying questions OR a section patch.
export const RefineSectionResult = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("questions"), items: z.array(Question).min(1).max(4) }),
  z.object({ kind: z.literal("section"), patch: PrdSectionPatchSchema }),
]);

// Forced on the final round: the model must return a section patch, not questions.
export const RefineSectionFinalResult = z.object({
  kind: z.literal("section"),
  patch: PrdSectionPatchSchema,
});

// ── Quote ──────────────────────────────────────────────────────────────────
// A priced quote breakdown (the Sherwood structure). Reuses the Question schema
// above for the wizard/refine interview. Money fields are plain numbers (dollars).
const QuoteLineItemSchema = z.object({
  label: z.string().min(1).max(200),
  // Effort-based pricing: the model returns hours; the runtime computes the
  // amount as hours × hourlyRate. Amount defaults to 0 so the model may omit it.
  hours: z.number().nonnegative().max(100000).nullish(),
  amount: z.number().nonnegative().default(0),
  notes: z.string().max(400).nullish(),
});

const QuoteModuleSchema = z.object({
  title: z.string().min(1).max(160),
  // One-line "Purpose" for the §1 product table.
  purpose: z.string().max(400).default(""),
  // The §2..N description paragraph.
  description: z.string().max(2000).nullish(),
  cost: z.number().nonnegative().default(0),
  lineItems: z.array(QuoteLineItemSchema).max(40).default([]),
  subtotal: z.number().nonnegative().default(0),
});

const QuoteDesignComponentSchema = z.object({
  component: z.string().min(1).max(160),
  included: z.boolean().default(true),
  notes: z.string().max(200).nullish(),
});

const QuotePaymentMilestoneSchema = z.object({
  label: z.string().min(1).max(160),
  amount: z.number().nonnegative().default(0),
  percent: z.number().min(0).max(100).nullish(),
});

// "Cost Overview" extra charges: a flat or percent-of-build add-on / design /
// fee, or a discount (which subtracts). amount is the resolved dollar magnitude.
const QuoteExtraCostSchema = z.object({
  label: z.string().min(1).max(160),
  kind: z.enum(["design", "addon", "fee", "discount"]).default("addon"),
  amount: z.number().nonnegative().default(0),
  percent: z.number().min(0).max(100).nullish(),
  notes: z.string().max(300).nullish(),
});

const QuoteTotalsSchema = z.object({
  grand: z.number().nonnegative().default(0),
  modulesTotal: z.number().nonnegative().nullish(),
  extrasTotal: z.number().nullish(),
  paymentTotal: z.number().nonnegative().nullish(),
});

export const QuoteContentSchema = z.object({
  companyName: z.string().max(200).optional(),
  clientName: z.string().max(200).optional(),
  productSubtitle: z.string().max(300).optional(),
  scopeSummary: z.string().max(3000).optional(),
  modules: z.array(QuoteModuleSchema).max(40).default([]),
  extraCosts: z.array(QuoteExtraCostSchema).max(20).default([]),
  designSystem: z.array(QuoteDesignComponentSchema).max(40).default([]),
  paymentMilestones: z.array(QuotePaymentMilestoneSchema).max(12).default([]),
  justification: z.array(z.string().min(1).max(400)).max(30).default([]),
  scopeProtection: z.array(z.string().min(1).max(400)).max(40).default([]),
  totals: QuoteTotalsSchema.optional(),
  hourlyRate: z.number().min(0).max(100000).nullish(),
  showHours: z.boolean().nullish(),
  validityDays: z.number().int().min(0).max(365).optional(),
  footerNote: z.string().max(1000).optional(),
});

// While the wizard may still ask more questions: questions OR a finished quote.
export const QuoteGenerationResult = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("questions"), items: z.array(Question).min(2).max(5) }),
  z.object({
    kind: z.literal("quote"),
    content: QuoteContentSchema,
    // Deep "no-context" flow only: a synthesized business-context narrative the
    // server writes back to projects.context for reuse. Absent in standard flows.
    contextSummary: z.string().max(2000).optional(),
  }),
]);

// Forced on the final round: the model must return a quote, not more questions.
export const QuoteFinalResult = z.object({
  kind: z.literal("quote"),
  content: QuoteContentSchema,
  contextSummary: z.string().max(2000).optional(),
});

// ── Quote section refine ─────────────────────────────────────────────────────
// A partial quote: the refine flow only ever touches one section's keys (the
// server whitelists to those keys), so every field is optional here.
export const QuoteSectionPatchSchema = QuoteContentSchema.partial();

export const RefineQuoteSectionResult = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("questions"), items: z.array(Question).min(1).max(4) }),
  z.object({ kind: z.literal("section"), patch: QuoteSectionPatchSchema }),
]);

export const RefineQuoteSectionFinalResult = z.object({
  kind: z.literal("section"),
  patch: QuoteSectionPatchSchema,
});

export type Question = z.infer<typeof Question>;
export type TaskDraft = z.infer<typeof TaskDraft>;
export type TaskGenerationResult = z.infer<typeof TaskGenerationResult>;
export type TaskOnlyResult = z.infer<typeof TaskOnlyResult>;
export type SubtaskDraft = z.infer<typeof SubtaskDraft>;
export type SubtasksResult = z.infer<typeof SubtasksResult>;
export type TaskEstimateResult = z.infer<typeof TaskEstimateResult>;
export type TaskClassifyResult = z.infer<typeof TaskClassifyResult>;
export type SimplifiedSubtask = z.infer<typeof SimplifiedSubtask>;
export type SimplifiedTask = z.infer<typeof SimplifiedTask>;
export type SimplifyTasksResult = z.infer<typeof SimplifyTasksResult>;
export type PrdGenerationResult = z.infer<typeof PrdGenerationResult>;
export type PrdFinalResult = z.infer<typeof PrdFinalResult>;
export type RefineSectionResult = z.infer<typeof RefineSectionResult>;
export type QuoteGenerationResult = z.infer<typeof QuoteGenerationResult>;
export type QuoteFinalResult = z.infer<typeof QuoteFinalResult>;
export type RefineQuoteSectionResult = z.infer<typeof RefineQuoteSectionResult>;
export type FreeTierServiceVerdict = z.infer<typeof FreeTierServiceVerdict>;
export type FreeTierAssumption = z.infer<typeof FreeTierAssumption>;
export type FreeTierAnalysis = z.infer<typeof FreeTierAnalysisResult>;
