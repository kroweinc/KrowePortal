export interface GitHubConnection {
  id: string;
  user_id: string;
  access_token: string;
  github_username: string;
  github_user_id: number;
  connected_at: string;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  default_branch: string;
  private: boolean;
  description: string | null;
  updated_at: string;
}

export type Role = "operator" | "builder";
export type TaskStatus = "backlog" | "todo" | "in_progress" | "done";
export type TaskSource = "operator_request" | "builder_added";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
// Linear-style change type. Null on legacy/unclassified tasks (see migration
// 0064); auto-set by the AI classifier on creation and overridable in the UI.
export type TaskType = "feature" | "bug" | "change";

// Fixed taxonomy of area labels the AI classifier may assign. A task gets
// exactly ONE of these (stored as a single-element tasks.tags array) — the
// closed list keeps labels consistent and prevents one-off free-form tags like
// "pdf-forms" or "export". Edit this list to change the allowed set.
export const TASK_TAGS = [
  "ui",
  "backend",
  "api",
  "database",
  "auth",
  "infra",
  "design",
  "performance",
  "docs",
  "growth",
  "ai",
] as const;
export type TaskTag = (typeof TASK_TAGS)[number];

export type OnboardingStatus = "in_progress" | "completed" | "dismissed";
// First-time product-tour lifecycle (separate from the onboarding form wizard).
export type TourStatus = "pending" | "completed" | "dismissed";
export type OnboardingPath = "no_clients" | "has_clients";
export type OnboardingStep = "path" | "prospect" | "handoff" | "client" | "repo" | "tasks" | "docs";

// Wizard-internal state — only the onboarding flow reads/writes this.
export interface OnboardingState {
  path?: OnboardingPath;
  step?: OnboardingStep;
  project_id?: string;
  engagement_id?: string;
  completed_at?: string;
}

export interface Profile {
  id: string;
  role: Role;
  display_name: string | null;
  created_at: string;
  onboarding_status: OnboardingStatus;
  onboarding: OnboardingState;
  tour_status: TourStatus;
}

/** Per-user email notification toggles (one row per user, see migration 0059).
    A missing row means all-on — keep these keys in sync with the migration
    columns and the NotifyType map in lib/email/notify.ts. */
export interface NotificationPreferences {
  user_id: string;
  notify_doc_signed: boolean;
  notify_change_order: boolean;
  notify_invite_accepted: boolean;
  updated_at: string;
}

export interface Engagement {
  id: string;
  operator_id: string | null;
  builder_id: string;
  title: string;
  created_at: string;
  // Set when the build actually begins — the builder explicitly begins the
  // engagement, or a contract is signed. Null while it's only a shell created
  // so an operator who accepted a doc gets portal access (see migration 0057).
  started_at?: string | null;
  project_id?: string | null;
  github_repo_full_name?: string | null;
  github_repo_owner?: string | null;
  github_repo_name?: string | null;
  github_default_branch?: string | null;
  operator?: { display_name: string | null };
  // The source project, joined on project_id. Carries the business contact so
  // engagement views can surface it without a separate fetch. Structural subset
  // of Project — keep field names aligned with the projects table.
  project?:
    | {
        id: string;
        name: string;
        prospect_name?: string | null;
        prospect_email?: string | null;
        website_url?: string | null;
        linkedin_url?: string | null;
        live_url?: string | null;
        context?: string | null;
      }
    | null;
}

export interface Task {
  id: string;
  engagement_id: string;
  title: string;
  description: string | null;
  source: TaskSource;
  // Linear-style change type and AI-generated area labels (migration 0064).
  type: TaskType | null;
  tags: string[];
  status: TaskStatus;
  priority: TaskPriority;
  builder_estimate_hours: number | null;
  builder_estimate_low_hours: number | null;
  builder_estimate_high_hours: number | null;
  sort_order: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  pushed_to_main: boolean;
  completion_note: string | null;
  completed_at: string | null;
  approval_sent_at: string | null;
  approval_approved_at: string | null;
  milestone_id: string | null;
  engagement?: Engagement;
  // The person who submitted the task, joined on created_by. Surfaced in place of
  // the old operator/builder source badge. Absent unless the query selects it.
  // avatar_url is not a profiles column — it's resolved server-side (uploaded
  // profile photo, else Google account photo) via lib/submitter-avatars.ts.
  creator?: { display_name: string | null; role: Role; avatar_url?: string | null } | null;
  task_attachments?: TaskAttachment[];
}

export type MilestoneStatus = "pending" | "in_progress" | "done";

export interface Milestone {
  id: string;
  brief_id: string | null;
  quote_id?: string | null;
  engagement_id: string;
  title: string;
  description: string | null;
  sort_order: number;
  status: MilestoneStatus;
  source_amount: number | null;
  created_at: string;
  updated_at: string;
}

// ---- Phase 7: Context & Collaboration ----

export type AvailabilityStatus = "available" | "limited" | "away";

export interface BuilderAvailability {
  engagement_id: string;
  status: AvailabilityStatus;
  weekly_hours: number | null;
  note: string | null;
  updated_at: string;
}

export interface Deliverable {
  id: string;
  engagement_id: string;
  milestone_id: string | null;
  author_id: string;
  title: string;
  body: string | null;
  url: string | null;
  created_at: string;
}

export type ContextMaterialKind = "link" | "note";

export interface ContextMaterial {
  id: string;
  engagement_id: string;
  kind: ContextMaterialKind;
  title: string;
  url: string | null;
  body: string | null;
  category: string | null;
  uploaded_by: string;
  created_at: string;
}

export type BusinessContextKind = "old_workflow" | "problem";

export interface BusinessContextCard {
  engagement_id: string;
  kind: BusinessContextKind;
  body: string;
  updated_at: string;
}

// ---- Phase 8: Operating agreement ----

export type PriorityKey = "quality" | "speed" | "cost" | "security";
export type BillingMode = "fixed" | "hourly";

export interface DecisionRight {
  decision: string;
  signer: string;
  reviewer: string;
  informed: string;
}

export interface CommChannel {
  channel: string;
  purpose: string;
}

export interface EngagementAgreement {
  engagement_id: string;
  priority_profile: PriorityKey[];
  warranty_days: number;
  decision_rights: DecisionRight[];
  review_cadence: string | null;
  meeting_schedule: string | null;
  comm_channels: CommChannel[];
  billing_mode: BillingMode;
  monthly_recurring: number | null;
  urgency_multiplier: number;
  updated_at: string;
}

// ---- Phase 9: Financials ----

export interface InfraRecommendation {
  id: string;
  engagement_id: string;
  category: string | null;
  item: string;
  recommended_monthly: number | null;
  operator_override: string | null;
  operator_override_monthly: number | null;
  accepted: boolean;
  created_by: string;
  created_at: string;
}

// ---- Phase 10: Change orders ----

export type ChangeOrderStatus = "draft" | "sent" | "signed" | "rejected";

export interface ChangeOrderContent {
  summary?: string;
  lineItems?: BriefLineItem[];
  hourlyRate?: number;
  total?: number;
}

export interface ChangeOrder {
  id: string;
  engagement_id: string;
  brief_id: string | null;
  title: string;
  content: ChangeOrderContent;
  status: ChangeOrderStatus;
  token: string | null;
  delta_amount: number | null;
  signed_by_name: string | null;
  signed_at: string | null;
  signer_ip: string | null;
  rejected_at: string | null;
  rejection_note: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface Subtask {
  id: string;
  task_id: string;
  created_by: string;
  title: string;
  completed: boolean;
  position: number;
  ai_est_low_min: number | null;
  ai_est_high_min: number | null;
  actual_hours: number | null;
  created_at: string;
  updated_at: string;
}

export type BriefStatus = "draft" | "sent" | "signed" | "accepted" | "rejected";

// Structured discovery-call SOP fields, parsed from raw pasted notes.
// Mirrors the discovery-call SOP sections (business context → risk flags).
export interface SopIntake {
  businessContext?: string;
  theirIdeas?: string;
  whyNow?: string;
  problemCurrentState?: string;
  desiredOutcome?: string;
  scope?: string;
  audienceBrand?: string;
  stackAccessOwnership?: string;
  stakeholders?: string;
  timelineConstraints?: string;
  budgetSignal?: string;
  riskFlags?: string[];
}

export interface BriefLineItem {
  label: string;
  hours?: number | null;
  amount: number;
  notes?: string | null;
}

export interface BriefDeliverable {
  title: string;
  acceptanceCriteria?: string | null;
}

export interface BriefTotals {
  preWork: number;
  project: number;
  grand: number;
}

export interface BriefContent {
  summary?: string;
  proposedSolution?: string;
  deliverables?: BriefDeliverable[];
  preWork?: BriefLineItem[];
  projectLineItems?: BriefLineItem[];
  outOfScope?: string[];
  assumptions?: string[];
  timeline?: string;
  paymentTerms?: string;
  hourlyRate?: number;
  validityDays?: number;
  totals?: BriefTotals;
}

export interface Brief {
  id: string;
  engagement_id: string | null;
  project_id: string | null;
  created_by: string;
  title: string;
  status: BriefStatus;
  content: BriefContent;
  sop_intake: SopIntake;
  token: string;
  sent_at: string | null;
  accepted_at: string | null;
  accepted_by: string | null;
  rejected_at: string | null;
  rejection_note: string | null;
  signed_by_name: string | null;
  signed_at: string | null;
  signer_ip: string | null;
  signature_consent: boolean;
  created_at: string;
  updated_at: string;
}

// ── Outbound documents (Projects → Quote / PRD / Contract) ─────────────
// Shared status for outbound, builder-only documents. No "accepted" —
// that transition is inbound-only (operator review of an engagement brief).
export type DocStatus = "draft" | "sent" | "signed" | "rejected";

export type ProjectStatus = "active" | "won" | "lost" | "archived";

// A builder-owned prospective business. Quote/PRD/Contract docs hang off it.
export interface Project {
  id: string;
  owner_id: string;
  name: string;
  status: ProjectStatus;
  prospect_name: string | null;
  prospect_email: string | null;
  linkedin_url: string | null;
  website_url: string | null;
  live_url: string | null; // the deliverable itself — deployed app / live demo
  context: string | null; // freeform notes (secondary to the structured fields above)
  created_at: string;
  updated_at: string;
}

// A supporting context material on a project — either a pasted link or an
// uploaded file. Mirrors TaskAttachment; one row per material.
export type ProjectMaterialType = "link" | "file";

export interface ProjectMaterial {
  id: string;
  project_id: string;
  uploaded_by: string;
  material_type: ProjectMaterialType;
  label: string | null; // link display label
  file_name: string | null; // original file name (files only)
  url: string | null; // external URL (links only)
  storage_path: string | null; // bucket path (files only)
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
}

// A discovery-call transcript (SOP) on a project. Unlike a material, the
// transcript TEXT is extracted on upload and stored in `content` — it's the
// canonical discovery source the PRD/quote/contract generators read.
export type SopSourceType = "file" | "paste";

export interface ProjectSopTranscript {
  id: string;
  project_id: string;
  uploaded_by: string;
  label: string | null; // builder name, derived filename, or "Pasted transcript"
  source_type: SopSourceType;
  file_name: string | null; // original file name (file source only)
  storage_path: string | null; // original file in project-materials bucket (file source only)
  mime_type: string | null;
  content: string; // extracted/pasted transcript text — what the AI reads
  char_count: number | null;
  created_at: string;
}

// ── Product Feedback ───────────────────────────────────────────────────
export type FeedbackCategory = "bug" | "idea" | "other";

export interface ProductFeedback {
  id: string;
  user_id: string;
  user_role: Role; // snapshot of the submitter's role at submission time
  category: FeedbackCategory;
  rating: number | null; // 1–5; nullable in DB, required by the form
  message: string;
  page_path: string | null; // route the user was on when submitting
  created_at: string;
}

// ── PRD ────────────────────────────────────────────────────────────────
export type PrdPriority = "must" | "should" | "could";

export interface PrdFeature {
  title: string;
  description?: string | null;
  priority?: PrdPriority | null;
  details?: string[]; // enumerated specifics: fields, columns, statuses, actions
  examples?: string[]; // illustrative sample values (e.g. "REF-1024")
}

// §3 — who's it for: one entry per user type, with their authorization level.
export interface PrdUserRole {
  role: string;
  description?: string | null; // narrative for this named user sub-group
  authLevel?: string | null;
  permissions?: string[];
}

// §7 — data model & sources: what data moves in/out and where it comes from.
export interface PrdDataSource {
  data: string;
  direction?: "import" | "export" | "both" | null;
  source?: string | null;
}

// §8 — 3rd-party software: the product's own monthly rate (not setup/dev cost).
export interface PrdIntegration {
  name: string;
  purpose?: string | null;
  monthlyCost?: string | null;
  estimated?: boolean;
  domain?: string | null; // official site host (e.g. "stripe.com") — drives the brand logo
}

// §9 — tech stack + infrastructure the builder will use.
export interface PrdStackItem {
  name: string;
  category?: string | null;
  provider?: string | null;
  layer?: "frontend" | "backend" | "database" | "email" | "hosting" | "other" | null;
  includes?: string[]; // what this layer covers
  monthlyCost?: string | null;
  estimated?: boolean;
  domain?: string | null; // official site host (e.g. "vercel.com") — drives the brand logo
}

// Pages / screens: every screen in this version and what it displays.
export interface PrdPage {
  name: string;
  description?: string | null;
  displays?: string[];
}

// §10 — UX flows: one journey per user type, as ordered steps.
export interface PrdUxFlow {
  role: string;
  steps?: string[]; // structured, ordered steps (new canonical shape)
  flow?: string; // legacy single-paragraph journey (auto-split into steps on render)
}

// §12 — constraints (structured).
export interface PrdConstraints {
  deadline?: string | null;
  budget?: string | null;
  branding?: string | null;
  security?: string | null;
}

// §14 — milestones: what's due by each date.
export interface PrdMilestone {
  label: string;
  dueDate?: string | null;
}

// Free-Tier Fit (companion to §8/§9): per-service verdict on whether this product
// can run on the provider's free tier, and the dimension that would force an upgrade.
export interface FreeTierServiceVerdict {
  name: string;
  provider?: string | null;
  hasFreeTier: boolean;
  fitsFree: "yes" | "risky" | "no";
  freeTierSummary?: string | null; // the limits this verdict was reasoned against
  estimatedUsage?: string | null; // inferred usage on the limiting dimension
  limitingFactor?: string | null; // dimension forcing/threatening an upgrade
  recommendedPaidTier?: string | null; // next tier + rate
  estimated?: boolean;
}

// One usage figure the verdicts rest on, shown as an editable stat the builder
// can correct (e.g. { label: "Monthly active users", value: "~5,000" }).
export interface FreeTierAssumption {
  label: string;
  value: string;
}

export interface FreeTierAnalysis {
  overallFitsFree: "yes" | "risky" | "no";
  primaryLimitingFactor?: string | null; // binding constraint across the stack
  totalMonthlyCostIfPaid?: string | null; // cost if non-fitting services go paid
  assumptions: FreeTierAssumption[]; // inferred-usage stats — the editable knobs
  services: FreeTierServiceVerdict[];
  analyzedAt?: string | null; // ISO stamp set by the action
  analyzedStack?: string[] | null; // normalized stack+integration names when it ran — for staleness
}

export interface PrdContent {
  overview?: string; // §1
  goals?: string[]; // §2 — finished-product outcomes
  successMetrics?: string[]; // §2 — adoption/usage signals
  users?: PrdUserRole[]; // §3
  targetUsers?: string; //    legacy free-text fallback
  coreUserFlow?: string[]; //    numbered end-to-end walkthrough
  features?: PrdFeature[]; // §4
  requirements?: string[]; // §4
  pagesScreens?: PrdPage[]; //    every screen + what it displays
  successCriteria?: string[]; //    testable acceptance checklist
  nonFunctionalRequirements?: string[]; // §5 — load time, setup, security
  scopeLater?: string[]; // §6 — deferred-to-later features
  futureExpansion?: string[]; //    post-MVP upgrade opportunities
  nonGoals?: string[]; //    legacy fallback
  dataModel?: PrdDataSource[]; // §7
  integrations?: PrdIntegration[]; // §8
  techStack?: PrdStackItem[]; // §9
  uxFlows?: PrdUxFlow[]; // §10
  assumptions?: string[]; // §11 — what the client must provide
  constraintsDetail?: PrdConstraints; // §12
  constraints?: string[]; //    legacy fallback
  risks?: string[]; // §13
  openQuestions?: string[]; // §13
  milestoneDueDate?: string | null; // §14 — overall deadline the milestones build toward
  milestoneList?: PrdMilestone[]; // §14
  milestones?: string; //    legacy fallback
  scaleAssumptions?: string; // Free-Tier Fit — optional builder usage hint
  freeTierAnalysis?: FreeTierAnalysis; // Free-Tier Fit — cached analysis
}

export interface Prd {
  id: string;
  project_id: string;
  created_by: string;
  title: string;
  status: DocStatus;
  content: PrdContent;
  source_notes: string | null;
  token: string;
  token_expires_at: string | null; // share-link expiry (migration 0062)
  token_revoked_at: string | null; // set when the share link is revoked
  sent_at: string | null;
  signed_by_name: string | null;
  signed_at: string | null;
  signer_ip: string | null;
  signature_consent: boolean;
  signed_by_user_id: string | null;
  rejected_at: string | null;
  rejection_note: string | null;
  created_at: string;
  updated_at: string;
}

// ── Quote ────────────────────────────────────────────────────────────────
// Reuses BriefLineItem ({ label, amount, notes? }) for line-item rows.
export type QuoteStatus = "draft" | "sent" | "signed" | "accepted" | "rejected";

// §1 product area + §2..N detailed module section. cost mirrors the sum of
// the module's line-item amounts (kept in sync by recomputeTotals).
export interface QuoteModule {
  id?: string; // stable key for inline editing
  title: string;
  purpose: string; // §1 "Purpose" column — one line
  description?: string | null; // §2..N description paragraph
  cost: number;
  lineItems?: BriefLineItem[]; // Item | Cost rows
  subtotal?: number; // Σ lineItems[].amount
}

// "Design System Included" table: a component + whether it's in scope.
export interface QuoteDesignComponent {
  component: string;
  included: boolean;
  notes?: string | null;
}

// "Suggested Payment Structure": a milestone + the amount due.
export interface QuotePaymentMilestone {
  label: string;
  amount: number;
  percent?: number | null; // e.g. 50 / 25 / 25
}

// A charge beyond the build modules, shown in the top "Cost Overview": a
// design-system charge, an add-on, a fee, or a discount (which subtracts).
export type QuoteExtraCostKind = "design" | "addon" | "fee" | "discount";

export interface QuoteExtraCost {
  id?: string; // stable key for inline editing
  label: string;
  kind: QuoteExtraCostKind;
  amount: number; // resolved dollar magnitude (nonnegative); discount applies the sign
  percent?: number | null; // when set, amount = round(percent/100 × modulesTotal)
  notes?: string | null;
}

export interface QuoteTotals {
  grand: number; // "Total Project Quote" banner — modulesTotal + extrasTotal
  modulesTotal?: number | null; // §1 table build subtotal (Σ module costs)
  extrasTotal?: number | null; // Σ extra costs (discounts subtract; may be negative)
  paymentTotal?: number | null; // payment table Total row
}

export interface QuoteContent {
  companyName?: string; // header client/company name
  clientName?: string; // the individual the quote is prepared for
  productSubtitle?: string; // header product subtitle (e.g. "AI Calls MVP")
  scopeSummary?: string; // scope summary paragraph
  modules?: QuoteModule[]; // §1 product table + §2..N module sections
  extraCosts?: QuoteExtraCost[]; // "Cost Overview" add-ons / design / fees / discounts
  designSystem?: QuoteDesignComponent[]; // "Design System Included"
  paymentMilestones?: QuotePaymentMilestone[]; // "Suggested Payment Structure"
  justification?: string[]; // "Why This Price Is Justified"
  scopeProtection?: string[]; // "Not included unless separately quoted"
  totals?: QuoteTotals;
  hourlyRate?: number; // blended rate line items are priced at (hours × rate)
  showHours?: boolean; // surface the hours estimate on the client-facing quote
  validityDays?: number; // how long the quote is valid
  footerNote?: string; // "Prepared from the … PRD. Pricing is an estimate…"
}

export interface Quote {
  id: string;
  project_id: string;
  created_by: string;
  title: string;
  status: QuoteStatus;
  content: QuoteContent;
  source_notes: string | null;
  source_prd_id: string | null; // PRD this quote was priced from (from-PRD path)
  token: string;
  token_expires_at: string | null; // share-link expiry (migration 0062)
  token_revoked_at: string | null; // set when the share link is revoked
  sent_at: string | null;
  signed_by_name: string | null;
  signed_at: string | null;
  signer_ip: string | null;
  signature_consent: boolean;
  signed_by_user_id: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  rejection_note: string | null;
  created_at: string;
  updated_at: string;
}

// ── Contract ─────────────────────────────────────────────────────────────
export interface ContractParties {
  provider?: string;
  client?: string;
}

// Exhibit B — a row in the snapshotted Payment Schedule (from the quote's
// payment milestones). Amounts are frozen into the contract at draft time.
export interface ContractPaymentMilestone {
  label: string;
  amount: number;
  percent?: number | null; // e.g. 50 / 25 / 25
}

// Exhibit A — a row in the snapshotted Scope of Work (from the quote's build
// modules: what's being built and its priced cost).
export interface ContractScopeItem {
  title: string;
  purpose?: string | null;
  cost?: number | null;
}

export interface ContractContent {
  parties?: ContractParties;
  effectiveDate?: string | null;
  scopeOfServices?: string;
  deliverables?: string[];
  fees?: string;
  paymentTerms?: string;
  timeline?: string;
  ipOwnership?: string;
  confidentiality?: string;
  warranties?: string;
  liability?: string;
  termination?: string;
  changeManagement?: string;
  governingLaw?: string;
  additionalTerms?: string[];
  // Exhibits snapshotted from the project's quote at draft/regenerate time.
  // Frozen here so a signed contract never changes if the quote is later edited.
  quoteTotal?: number | null;
  scopeItems?: ContractScopeItem[];
  paymentSchedule?: ContractPaymentMilestone[];
}

export interface Contract {
  id: string;
  project_id: string;
  created_by: string;
  title: string;
  status: DocStatus;
  content: ContractContent;
  source_notes: string | null;
  token: string;
  token_expires_at: string | null; // share-link expiry (migration 0062)
  token_revoked_at: string | null; // set when the share link is revoked
  sent_at: string | null;
  signed_by_name: string | null;
  signed_at: string | null;
  signer_ip: string | null;
  signature_consent: boolean;
  signed_by_user_id: string | null;
  rejected_at: string | null;
  rejection_note: string | null;
  created_at: string;
  updated_at: string;
}

// List/summary projections — omit the heavy `content` jsonb for dashboard list
// reads that only render title/status/dates/token. Detail views use the full type.
// (Quotes are intentionally excluded: their list rows show content.totals.grand.)
export type PrdSummary = Omit<Prd, "content">;
export type ContractSummary = Omit<Contract, "content">;

export type AttachmentType = "file" | "link" | "text";

export interface TaskAttachment {
  id: string;
  task_id: string;
  uploaded_by: string;
  attachment_type: AttachmentType;
  file_name: string;
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  url: string | null;
  text_content: string | null;
  is_deliverable: boolean;
  created_at: string;
  uploader?: Pick<Profile, "id" | "display_name" | "role">;
}

// ============================================================
// Builder Profile — shareable resume (see 0040_builder_profiles.sql)
// ============================================================

export type ProfileProjectSource = "github" | "manual";

export interface RepoLanguage {
  name: string;
  pct: number;
}

export interface BuilderProfile {
  id: string;
  user_id: string;
  display_name: string | null; // override for the public page; null = account name
  headline: string | null;
  bio: string | null;
  linkedin_url: string | null;
  github_url: string | null;
  portfolio_url: string | null;
  education_school: string | null; // university or high school
  education_major: string | null;
  education_year: string | null; // freeform, e.g. "Class of 2027" or "2020 – 2024"
  resume_storage_path: string | null;
  resume_file_name: string | null;
  avatar_storage_path: string | null;
  is_published: boolean;
  token: string;
  token_expires_at: string | null; // share-link expiry (migration 0062)
  token_revoked_at: string | null; // set when the share link is revoked
  github_synced_at: string | null;
  tags: string[]; // achievement/identity badges, e.g. "Hackathon Winner"
  // Quote defaults — the base pricing every new quote starts from (0058).
  default_hourly_rate: number; // blended rate line items price at (hours × rate)
  payment_terms_preset: PaymentTermsPreset; // seeds paymentMilestones on new quotes
  design_system_mode: DesignSystemMode; // how the design system is handled
  design_fixed_cost: number; // the charge when design_system_mode === "fixed"
  created_at: string;
  updated_at: string;
}

// Builder quote-default option sets. The DB check constraints in
// 0058_quote_pricing_defaults.sql mirror these — keep them in sync.
export const PAYMENT_TERMS_PRESETS = ["50_25_25", "50_50", "100_upfront", "34_33_33"] as const;
export type PaymentTermsPreset = (typeof PAYMENT_TERMS_PRESETS)[number];

export const DESIGN_SYSTEM_MODES = ["included", "fixed", "none"] as const;
export type DesignSystemMode = (typeof DESIGN_SYSTEM_MODES)[number];

export interface BuilderProfileProject {
  id: string;
  builder_profile_id: string;
  source: ProfileProjectSource;
  name: string;
  description: string | null;
  url: string | null;
  live_url: string | null; // deployed app / demo; survives GitHub syncs
  tech: string[];
  github_repo_id: number | null;
  github_repo_full_name: string | null;
  github_is_private: boolean | null;
  commit_count: number | null;
  languages: RepoLanguage[] | null;
  stars: number | null;
  github_pushed_at: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface BuilderProfileExperience {
  id: string;
  builder_profile_id: string;
  role: string;
  company: string;
  /** Verified website host (e.g. "patelgaines.com") captured when the builder
      picks a company from the autocomplete; null for free-typed names. */
  company_domain: string | null;
  start_label: string | null;
  end_label: string | null;
  description: string | null;
  display_order: number;
  created_at: string;
}

// Ordered for display: the public profile groups tools into these buckets in
// this order. Uncategorized tools fall into "Other". Stored as free text;
// validated app-side so the set can grow without a migration.
export const CODING_TOOL_CATEGORIES = [
  "AI Assistant",
  "Editor / IDE",
  "CLI / Terminal",
  "DevOps / Cloud",
  "Design",
  "Productivity",
  "Other",
] as const;

export type CodingToolCategory = (typeof CODING_TOOL_CATEGORIES)[number];

// Suggested achievement/identity badges for the builder profile. These only
// seed the editor's suggestions — builders can type any custom tag (e.g.
// "7x Years Developing"). Stored as free text in builder_profiles.tags.
export const BUILDER_TAG_PRESETS = [
  "Hackathon Winner",
  "Startup Founder",
  "Open Source Contributor",
  "Indie Hacker",
  "Technical Co-Founder",
  "Full-Stack Developer",
  "AI / ML Engineer",
  "Y Combinator Alum",
  "Published Author",
  "Conference Speaker",
  "Self-Taught Developer",
  "CS Student",
  "Freelance Developer",
  "Shipped a Product",
  "Bootcamp Grad",
] as const;

export interface BuilderProfileCodingTool {
  id: string;
  builder_profile_id: string;
  name: string;
  category: CodingToolCategory | null;
  url: string | null;
  display_order: number;
  created_at: string;
}
