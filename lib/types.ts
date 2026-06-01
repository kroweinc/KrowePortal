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
export type TaskStatus = "inbox" | "in_progress" | "blocked" | "done";
export type TaskSource = "operator_request" | "builder_added";
export type TaskPriority = "low" | "medium" | "high" | "urgent";

export interface Profile {
  id: string;
  role: Role;
  display_name: string | null;
  created_at: string;
}

export interface Engagement {
  id: string;
  operator_id: string;
  builder_id: string;
  title: string;
  created_at: string;
  operator?: { display_name: string | null };
}

export interface Task {
  id: string;
  engagement_id: string;
  title: string;
  description: string | null;
  source: TaskSource;
  status: TaskStatus;
  priority: TaskPriority;
  operator_visible: boolean;
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
  task_attachments?: TaskAttachment[];
}

export type MilestoneStatus = "pending" | "in_progress" | "done";

export interface Milestone {
  id: string;
  brief_id: string;
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
  context: string | null;
  created_at: string;
  updated_at: string;
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

export interface PrdUserStory {
  asA: string;
  iWant: string;
  soThat: string;
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
  userStories?: PrdUserStory[]; //    supporting
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
  sent_at: string | null;
  signed_by_name: string | null;
  signed_at: string | null;
  signer_ip: string | null;
  signature_consent: boolean;
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
  sent_at: string | null;
  signed_by_name: string | null;
  signed_at: string | null;
  signer_ip: string | null;
  signature_consent: boolean;
  rejected_at: string | null;
  rejection_note: string | null;
  created_at: string;
  updated_at: string;
}

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
