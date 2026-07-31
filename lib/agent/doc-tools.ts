import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { updatePrdContent, refinePrdSection } from "@/lib/actions/prds";
import { updateQuoteContent, refineQuoteSection } from "@/lib/actions/quote-docs";
import { updateContractContent } from "@/lib/actions/contracts";
import {
  serializeDocumentForContext,
  DOC_KIND_LABEL,
  type SyncDocKind,
} from "@/lib/context/serialize-documents";
import {
  REFINABLE_SECTIONS as PRD_REFINABLE,
  isRefinable as isPrdRefinable,
} from "@/lib/prd/section-fields";
import { QUOTE_SECTIONS, isRefinable as isQuoteRefinable } from "@/lib/quote/section-fields";
import { applyTechSwap, fillSwappedRows } from "@/lib/prd/swap-tech";
import { reconcileTechReferencesAction, lookupStackItemAction } from "@/lib/actions/lookup-tech";
import type { PrdContent, QuoteContent, ContractContent } from "@/lib/types";
import type { ToolContext, ToolDef } from "./tools";

// The document half of the context agent's tool registry. Every write tool here
// is a thin, confirm-gated wrapper over an existing `"use server"` action in
// lib/actions/ (updatePrdContent / updateQuoteContent / updateContractContent,
// and the AI section-refine seams). The same two rules that govern task-tools.ts
// hold throughout:
//   1. Scope is injected from the authorized run (ctx.projectId / ctx.builderId)
//      — never the model. The model passes a document TITLE, or nothing to act on
//      the document in view.
//   2. Documents hang off a PROJECT. When the builder is on a document page the
//      run carries that project (ctx.projectId); otherwise we fall back to the
//      engagement's linked project. Scoping by ctx.projectId is what lets these
//      tools reach a DRAFT under an orphan project that no engagement links to.
// Read tools (list_documents / read_document) auto-run inside the background turn
// loop where cookies are unavailable, so they use the admin client scoped by
// created_by = ctx.builderId (mirroring list_tasks). Write tools execute in
// confirmToolCall's request scope, so the wrapped actions' getCurrentProfile()/RLS
// checks re-authorize as the builder there.

// ── the three outbound document kinds ─────────────────────────────────────
const KIND_ORDER: SyncDocKind[] = ["prd", "quote", "contract"];
const TABLE: Record<SyncDocKind, string> = { prd: "prds", quote: "quotes", contract: "contracts" };

interface ResolvedDoc {
  kind: SyncDocKind;
  id: string;
  title: string;
  status: string;
  content: PrdContent | QuoteContent | ContractContent;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function validKind(v: unknown): SyncDocKind | undefined {
  return v === "prd" || v === "quote" || v === "contract" ? v : undefined;
}

// ── shared resolver ────────────────────────────────────────────────────────
// The project the document tools act within: the viewed project (ctx.projectId)
// when the turn came from a document page, else the engagement's linked project.
// Scoping by the viewed project is what reaches an orphan-project draft.
async function projectForEngagement(
  admin: ReturnType<typeof createAdminClient>,
  engagementId: string
): Promise<string | null> {
  const { data } = await admin
    .from("engagements")
    .select("project_id")
    .eq("id", engagementId)
    .maybeSingle();
  return (data?.project_id as string | null) ?? null;
}

async function resolveProjectId(
  admin: ReturnType<typeof createAdminClient>,
  ctx: ToolContext
): Promise<string | null> {
  if (ctx.projectId) return ctx.projectId;
  return projectForEngagement(admin, ctx.engagementId);
}

// Resolve the document to act on within the in-scope project. With a title, it
// matches it (ilike + exact-tiebreak, mirroring resolveTaskByTitle). WITHOUT a
// title it targets the project's SOLE document (optionally of `kind`) — so
// "read it" / "edit it" act on the document the builder is viewing. Returns the
// match or a human message the tool hands straight back to the model.
async function resolveDoc(
  ctx: ToolContext,
  opts: { title?: string; kind?: SyncDocKind }
): Promise<ResolvedDoc | { error: string }> {
  const admin = createAdminClient();
  const projectId = await resolveProjectId(admin, ctx);
  if (!projectId) return { error: "There's no document in view, and this client has no linked project yet." };

  const title = (opts.title ?? "").trim();
  const kinds = opts.kind ? [opts.kind] : KIND_ORDER;
  const matches: ResolvedDoc[] = [];
  for (const k of kinds) {
    let q = admin
      .from(TABLE[k])
      .select("id, title, status, content")
      .eq("project_id", projectId)
      .eq("created_by", ctx.builderId);
    if (title) q = q.ilike("title", `%${title}%`);
    const { data } = await q.limit(10);
    for (const row of (data ?? []) as {
      id: string;
      title: string;
      status: string;
      content: PrdContent | QuoteContent | ContractContent;
    }[]) {
      matches.push({ kind: k, id: row.id, title: row.title, status: row.status, content: row.content });
    }
  }

  if (matches.length === 0) {
    return { error: title ? `No document in view matches "${title}".` : "This project has no documents yet." };
  }
  if (matches.length === 1) return matches[0];

  // Multiple candidates — an exact title match wins; otherwise ask which.
  if (title) {
    const exact = matches.filter((m) => m.title.toLowerCase() === title.toLowerCase());
    if (exact.length === 1) return exact[0];
  }
  return {
    error: `Which document? ${matches
      .map((m) => `${DOC_KIND_LABEL[m.kind]} "${m.title}"`)
      .join(", ")}${title ? "" : " — name it, or say which kind"}.`,
  };
}

// Route a persisted edit to the right update action. Each re-applies its own
// guards (builder role + created_by ownership, schema validation, quote total
// recompute, contract "signed → blocked") and re-syncs the context layer.
async function persistDocEdit(
  kind: SyncDocKind,
  id: string,
  updates: { title?: string; content?: Record<string, unknown> }
): Promise<{ success: true } | { error: string }> {
  if (kind === "prd") {
    return updatePrdContent(id, {
      title: updates.title,
      content: updates.content as PrdContent | undefined,
    });
  }
  if (kind === "quote") {
    return updateQuoteContent(id, {
      title: updates.title,
      content: updates.content as QuoteContent | undefined,
    });
  }
  return updateContractContent(id, {
    title: updates.title,
    content: updates.content as ContractContent | undefined,
  });
}

// Resolve the title of the document the builder is viewing (id + kind from the
// URL). Scoped by created_by = builderId — the ownership guard — so a spoofed id
// resolves to nothing. Used by the turn engine to bake the viewed document into a
// doc tool-call that arrived without a title, so "change the document" assumes the
// one on screen. Returns the kind + exact title to inject, or null if it's gone.
export async function resolveViewedDocRef(
  viewedDoc: { kind: SyncDocKind; id: string },
  builderId: string
): Promise<{ kind: SyncDocKind; title: string } | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from(TABLE[viewedDoc.kind])
    .select("title")
    .eq("id", viewedDoc.id)
    .eq("created_by", builderId)
    .maybeSingle();
  const title = typeof data?.title === "string" ? data.title.trim() : "";
  return title ? { kind: viewedDoc.kind, title } : null;
}

// ── read: list_documents ───────────────────────────────────────────────────
const listDocumentsTool: ToolDef = {
  kind: "read",
  spec: {
    type: "function",
    function: {
      name: "list_documents",
      description:
        "List the documents in view — PRDs, quotes, and contracts — by title and status. Call this to discover exact document titles before reading or editing one.",
      parameters: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["prd", "quote", "contract"],
            description: "Optional — only documents of this kind.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  async execute(args, ctx) {
    const kindFilter = validKind(args.kind);
    const admin = createAdminClient();
    const projectId = await resolveProjectId(admin, ctx);
    if (!projectId) return { content: "There's no project in view, so there are no documents." };

    const kinds = kindFilter ? [kindFilter] : KIND_ORDER;
    const lines: string[] = [];
    for (const k of kinds) {
      const { data } = await admin
        .from(TABLE[k])
        .select("title, status")
        .eq("project_id", projectId)
        .eq("created_by", ctx.builderId)
        .order("created_at", { ascending: false });
      const rows = (data ?? []) as { title: string; status: string }[];
      if (rows.length) {
        lines.push(
          `${DOC_KIND_LABEL[k]}s: ${rows.map((r) => `"${r.title}" (${r.status})`).join(", ")}.`
        );
      }
    }

    if (!lines.length) {
      return { content: kindFilter ? `This client has no ${kindFilter}s.` : "This client has no documents yet." };
    }
    return { content: lines.join("\n") };
  },
};

// ── read: read_document ────────────────────────────────────────────────────
// Returns the document's exact current content (via the same serializer the RAG
// layer uses) so the model edits against ground truth, not truncated context.
const readDocumentTool: ToolDef = {
  kind: "read",
  spec: {
    type: "function",
    function: {
      name: "read_document",
      description:
        "Read a document in full — its current content, section by section. Omit the title to read the document the builder is viewing; otherwise pass a title. Call this before proposing an edit so you set fields against the document's actual current values.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description:
              "Optional — the document's title (or a distinctive part). Omit to read the document currently in view.",
          },
          kind: {
            type: "string",
            enum: ["prd", "quote", "contract"],
            description: "Optional — the document kind, if the title is ambiguous.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  async execute(args, ctx) {
    const resolved = await resolveDoc(ctx, { title: str(args.title), kind: validKind(args.kind) });
    if ("error" in resolved) return { content: resolved.error };

    const text = serializeDocumentForContext(resolved.kind, resolved.title, resolved.content);
    return {
      content: `${DOC_KIND_LABEL[resolved.kind]} — "${resolved.title}" (${resolved.status}):\n\n${
        text || "(This document is empty.)"
      }`,
    };
  },
};

// ── write: edit_document ───────────────────────────────────────────────────
// Direct, transparent field edits — the confirmed proposal shows the literal new
// values. The model supplies a `patch` of content keys → new values; execute
// merges it into the document's current content and routes to the right update
// action. `patch` is intentionally a free-form object (the three content shapes
// diverge too far for one strict schema); the update actions validate downstream.
const editDocumentTool: ToolDef = {
  kind: "write",
  spec: {
    type: "function",
    function: {
      name: "edit_document",
      description:
        "Edit a document by setting fields. Omit the title to edit the document the builder is viewing; otherwise reference it by title. " +
        "Pass `changes` — a map of content key → new value. LIST fields are ADDED to by default (existing items are kept), so 'add a goal' is just changes:{goals:[the new goal]} and needs no read. SCALAR fields (overview, targetUsers, scopeSummary…) are replaced. To reword, remove, or reorder items in a list, first read the document (read_document), pass the FULL new array in `changes`, and set replaceLists:true so it replaces instead of appends. Editable keys by kind — " +
        "PRD: overview, goals[], successMetrics[], requirements[], nonFunctionalRequirements[], assumptions[], risks[], openQuestions[], successCriteria[], scopeLater[], futureExpansion[], targetUsers, coreUserFlow[], constraints[]. " +
        "Quote: scopeSummary, justification[], scopeProtection[], companyName, clientName, productSubtitle, validityDays. " +
        "Contract: scopeOfServices, deliverables[], fees, paymentTerms, timeline, ipOwnership, confidentiality, warranties, liability, termination, changeManagement, governingLaw, additionalTerms[]. " +
        "For a rich nested section (a PRD's Features/Data Model/Tech Stack, a quote's Cost Breakdown/Payment Structure) use refine_document_section instead. A signed PRD or quote can still be edited — only a signed contract is locked. This is a proposal the builder confirms.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description:
              "Optional — the document's current title (or a distinctive part). Omit to edit the document currently in view.",
          },
          kind: {
            type: "string",
            enum: ["prd", "quote", "contract"],
            description: "Optional — the document kind, if the title is ambiguous.",
          },
          newTitle: {
            type: "string",
            description: "Optional — a new title for the document.",
          },
          changes: {
            type: "object",
            description:
              "Content fields to change, keyed by content key (see the key list above). List fields append by default; scalar fields replace. Include only the keys you're changing.",
            additionalProperties: true,
          },
          replaceLists: {
            type: "boolean",
            description:
              "Set true ONLY to replace list fields outright (reword / remove / reorder) instead of appending — pass the full new array and read the document first.",
          },
        },
        additionalProperties: false,
      },
    },
  },
  async execute(args, ctx) {
    const resolved = await resolveDoc(ctx, { title: str(args.title), kind: validKind(args.kind) });
    if ("error" in resolved) return { content: resolved.error };

    const changes =
      args.changes && typeof args.changes === "object" && !Array.isArray(args.changes)
        ? (args.changes as Record<string, unknown>)
        : undefined;
    const replaceLists = args.replaceLists === true;
    const newTitle = str(args.newTitle);
    const changedKeys = changes ? Object.keys(changes) : [];

    if (!newTitle && changedKeys.length === 0) {
      return { content: `No changes given for "${resolved.title}". Pass a changes map or a newTitle.` };
    }

    const updates: { title?: string; content?: Record<string, unknown> } = {};
    if (newTitle) updates.title = newTitle;
    if (changes) {
      const content: Record<string, unknown> = { ...(resolved.content as Record<string, unknown>) };
      for (const [key, val] of Object.entries(changes)) {
        // List fields append by default (dedupe exact string repeats, so passing
        // the full list is idempotent) — this keeps 'add a goal' from silently
        // dropping the existing goals. replaceLists opts into a full swap.
        if (Array.isArray(val) && !replaceLists) {
          const existing = Array.isArray(content[key]) ? (content[key] as unknown[]) : [];
          const additions = val.filter((v) => !(typeof v === "string" && existing.includes(v)));
          content[key] = [...existing, ...additions];
        } else {
          content[key] = val;
        }
      }
      updates.content = content;
    }

    const res = await persistDocEdit(resolved.kind, resolved.id, updates);
    if ("error" in res) return { content: `Couldn't edit "${resolved.title}": ${res.error}` };

    const parts: string[] = [];
    if (newTitle) parts.push(`renamed to "${newTitle}"`);
    if (changedKeys.length) parts.push(`${replaceLists ? "replaced" : "updated"} ${changedKeys.join(", ")}`);
    return {
      content: `Edited the ${DOC_KIND_LABEL[resolved.kind]} "${resolved.title}" (${parts.join("; ")}).`,
      // Hand the persisted document back so an open view of it can update live.
      docEdit: {
        kind: resolved.kind,
        id: resolved.id,
        title: newTitle || resolved.title,
        content: (updates.content ?? (resolved.content as Record<string, unknown>)),
      },
    };
  },
};

// ── write: refine_document_section ─────────────────────────────────────────
// AI rewrite of a single rich section, for PRDs and quotes (contracts have no
// refine seam). Delegates to refinePrdSection / refineQuoteSection with the
// builder's instruction as a synthetic answer and forceFinal (round ≥ the
// action's MAX_REFINE_ROUNDS) so it returns a patch instead of opening a
// clarifying-question loop the agent can't run inside one confirm. The refine
// seams don't persist, so we merge the returned patch and save it ourselves.
const REFINE_ROUND = 2;

const refineDocumentSectionTool: ToolDef = {
  kind: "write",
  spec: {
    type: "function",
    function: {
      name: "refine_document_section",
      description:
        "Use AI to rewrite one rich section of a PRD or quote from a plain-language instruction — for sections that are awkward to hand-edit (a PRD's features, dataModel, techStack, uxFlows, pagesScreens, users; a quote's modules, paymentMilestones, designSystem). Omit the title to refine the document the builder is viewing; otherwise reference it by title. Name the section by its id and describe the change. Contracts don't support refine — use edit_document. This is a proposal the builder confirms.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description:
              "Optional — the document's title (or a distinctive part). Omit to refine the document currently in view.",
          },
          kind: {
            type: "string",
            enum: ["prd", "quote"],
            description: "Optional — the document kind, if the title is ambiguous.",
          },
          section: {
            type: "string",
            description:
              "The section id to rewrite. PRD sections: overview, goals, successMetrics, users, coreUserFlow, features, requirements, pagesScreens, successCriteria, nonFunctionalRequirements, scopeLater, futureExpansion, dataModel, integrations, techStack, uxFlows, assumptions, constraints, risks, openQuestions, milestones. Quote sections: header, scopeSummary, modules, designSystem, paymentMilestones, justification, scopeProtection, footerNote.",
          },
          instruction: {
            type: "string",
            description: "What to change in that section, in plain language.",
          },
        },
        required: ["section", "instruction"],
        additionalProperties: false,
      },
    },
  },
  async execute(args, ctx) {
    const section = str(args.section);
    const instruction = str(args.instruction);
    if (!section) return { content: "Which section? Pass a section id." };
    if (!instruction) return { content: "What should change? Pass an instruction." };

    const resolved = await resolveDoc(ctx, { title: str(args.title), kind: validKind(args.kind) });
    if ("error" in resolved) return { content: resolved.error };

    if (resolved.kind === "contract") {
      return {
        content: "Contracts don't support AI section refine — use edit_document to set contract fields directly.",
      };
    }

    const answers = [
      {
        questionId: "agent-instruction",
        question: "The builder's instruction for this section",
        answer: instruction,
      },
    ];

    let patch: Record<string, unknown>;
    if (resolved.kind === "prd") {
      if (!isPrdRefinable(section)) {
        return {
          content: `"${section}" isn't a refinable PRD section. Options: ${PRD_REFINABLE.map((s) => s.id).join(", ")}.`,
        };
      }
      const r = await refinePrdSection({
        prdId: resolved.id,
        sectionId: section,
        currentContent: resolved.content as unknown as Record<string, unknown>,
        answers,
        round: REFINE_ROUND,
      });
      if ("error" in r) return { content: `Couldn't refine "${resolved.title}": ${r.error}` };
      if (r.kind === "questions") {
        return { content: "The refine needs more detail — add specifics to your instruction and try again." };
      }
      patch = r.patch as Record<string, unknown>;
    } else {
      if (!isQuoteRefinable(section)) {
        return {
          content: `"${section}" isn't a refinable quote section. Options: ${QUOTE_SECTIONS.map((s) => s.id).join(", ")}.`,
        };
      }
      const r = await refineQuoteSection({
        quoteId: resolved.id,
        sectionId: section,
        currentContent: resolved.content as unknown as Record<string, unknown>,
        answers,
        round: REFINE_ROUND,
      });
      if ("error" in r) return { content: `Couldn't refine "${resolved.title}": ${r.error}` };
      if (r.kind === "questions") {
        return { content: "The refine needs more detail — add specifics to your instruction and try again." };
      }
      patch = r.patch as Record<string, unknown>;
    }

    const merged = { ...(resolved.content as Record<string, unknown>), ...patch };
    const res = await persistDocEdit(resolved.kind, resolved.id, { content: merged });
    if ("error" in res) return { content: `Refined "${resolved.title}" but couldn't save it: ${res.error}` };

    return {
      content: `Refined the ${section} section of the ${DOC_KIND_LABEL[resolved.kind]} "${resolved.title}".`,
      // Hand the persisted document back so an open view of it can update live.
      docEdit: { kind: resolved.kind, id: resolved.id, title: resolved.title, content: merged },
    };
  },
};

// ── write: swap_prd_tech ───────────────────────────────────────────────────
// Cascade-swap one technology for another across a PRD — the agent-side twin of
// the builder's inline tech-stack rename (prd-sections.tsx). refine_document_section
// on techStack would only rewrite §9 and risks reshaping the whole section; this
// mirrors the deterministic UI flow instead: renameTechAcrossPrd swaps the old name
// everywhere it appears (the §9 stack row, the matching §8 integration, the
// Free-Tier Fit verdicts, and prose), then two best-effort AI passes finish it —
// reconcileTechReferences catches other name forms ("Postgres" vs "PostgreSQL"),
// and lookupStackItem re-fills the swapped stack row so the NEW tool's provider,
// layer, logo, and rate replace the retired one's. Both passes run inside
// confirmToolCall's request scope (cookies present), so their builder-role guard
// re-authorizes; neither is allowed to block the swap the literal rename already made.
const swapPrdTechTool: ToolDef = {
  kind: "write",
  spec: {
    type: "function",
    function: {
      name: "swap_prd_tech",
      description:
        "Swap one technology for another across a PRD's tech stack — e.g. change the database from Postgres to Supabase. Pass `from` (the current tool, as named in the PRD) and `to` (the replacement). It renames every mention deterministically — the §9 stack row, the matching §8 integration, the Free-Tier Fit verdicts, and prose — then refreshes the new tool's details (provider, layer, logo, typical rate). Prefer this over refine_document_section whenever the builder is REPLACING a named tool with another. Omit the title to act on the PRD the builder is viewing; otherwise pass its title. PRDs only. This is a proposal the builder confirms.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description:
              "Optional — the PRD's title (or a distinctive part). Omit to act on the PRD currently in view.",
          },
          from: {
            type: "string",
            description: 'The technology to replace, as it\'s named in the PRD (e.g. "Postgres").',
          },
          to: {
            type: "string",
            description: 'The replacement technology (e.g. "Supabase").',
          },
        },
        required: ["from", "to"],
        additionalProperties: false,
      },
    },
  },
  async execute(args, ctx) {
    const from = str(args.from);
    const to = str(args.to);
    if (!from || !to) return { content: "Name both technologies: `from` (the current one) and `to` (the replacement)." };
    if (from.toLowerCase() === to.toLowerCase()) return { content: `"${from}" and "${to}" are the same — nothing to swap.` };

    const resolved = await resolveDoc(ctx, { title: str(args.title), kind: "prd" });
    if ("error" in resolved) return { content: resolved.error };

    const before = resolved.content as PrdContent;

    // Best-effort semantic pass: surface any other name forms of the old tool
    // ("PostgreSQL" when the builder said "Postgres") so the deterministic cascade
    // catches them too. A failure just leaves the literal rename to stand alone.
    const rec = await reconcileTechReferencesAction(from, to, before);
    const reconciled = "data" in rec ? rec.data : [];

    // Deterministic cascade (rename + reconciled forms). If nothing changed, the old
    // tool isn't in this PRD — stop before the lookup so an unrelated existing `to`
    // row isn't re-enriched for a no-op.
    const { content: renamed, changed } = applyTechSwap(before, from, to, reconciled);
    if (!changed) {
      // Don't dead-end: surface the PRD's actual tech names so the next round can
      // recover — retry the swap with the exact name, or route an add/remove to
      // refine_document_section instead of the builder seeing "nothing happened".
      const names = (Array.isArray(before.techStack) ? before.techStack : [])
        .map((s) => (typeof s?.name === "string" ? s.name.trim() : ""))
        .filter(Boolean);
      const listing = names.length ? ` Its tech stack currently lists: ${names.join(", ")}.` : "";
      return {
        content:
          `"${resolved.title}" doesn't mention "${from}", so there was nothing to swap.${listing} ` +
          `If you meant to replace one of those, retry swap_prd_tech with its exact name; to ADD or REMOVE a tool, ` +
          `use refine_document_section on the techStack section instead.`,
      };
    }

    // Re-fill every stack row that now carries the new name, so its provider, layer,
    // logo, and rate reflect the replacement rather than the retired tool's stale
    // values. Best-effort — a failed/empty lookup just leaves the renamed row as-is.
    const look = await lookupStackItemAction(to, before.overview ?? undefined);
    const next = "data" in look ? fillSwappedRows(renamed, to, look.data) : renamed;

    const content = next as unknown as Record<string, unknown>;
    const res = await persistDocEdit("prd", resolved.id, { content });
    if ("error" in res) return { content: `Couldn't swap "${from}" for "${to}" in "${resolved.title}": ${res.error}` };

    return {
      content: `Swapped "${from}" → "${to}" across the PRD "${resolved.title}".`,
      // Hand the persisted document back so an open view of it updates live.
      docEdit: { kind: "prd", id: resolved.id, title: resolved.title, content },
    };
  },
};

// The document tools, spread into the main registry in tools.ts.
export const DOC_TOOLS: Record<string, ToolDef> = {
  list_documents: listDocumentsTool,
  read_document: readDocumentTool,
  edit_document: editDocumentTool,
  refine_document_section: refineDocumentSectionTool,
  swap_prd_tech: swapPrdTechTool,
};
