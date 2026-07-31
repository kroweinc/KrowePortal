"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  Brain,
  Briefcase,
  ChevronDown,
  FilePenLine,
  FileText,
  GitBranch,
  ListChecks,
  ListPlus,
  MessageSquare,
  Plus,
  Send,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";

import { Ember } from "@/components/design-atoms";
import { AgentThread } from "@/components/agent/agent-thread";
import { OverflowPills, type OverflowPill } from "@/components/ui/overflow-pills";
import { deleteAgentRun, listAgentRuns } from "@/lib/actions/agent";
import { hubKey, loadHub, peekHub } from "@/lib/agent/hub-cache";
import {
  BUILDER_NAV,
  ENGAGEMENT_PATH,
  JUMP_TO_IDS,
  resolveBuilderSection,
  type BuilderSection,
} from "@/lib/nav-commands";
import { krowecanFor, reducedHint, suggestionsFor } from "@/lib/agent/section-prompts";
import { relativeTime } from "@/lib/utils";
import { useTypewriter } from "@/lib/use-typewriter";
import type {
  AgentHubData,
  AgentHubEngagement,
  AgentRun,
  AgentRunStatus,
  EngagementContextSummary,
} from "@/lib/agent/types";

// The Agents Control Center's palette host — the "Agent Hub" entry state.
//
// Idle, this is the hub (design direction A): the prompt is the hero, the
// client's context sits up front as live chips, and capabilities/suggestions/
// recents replace the old empty state. Once the builder asks something (or
// opens a recent), the conversation itself is delegated to <AgentThread>, which
// the full-page workspace at /b/agent/[runId] reuses verbatim.
//
// This host owns the client: it resolves which engagement is in scope and hands
// it to the thread explicitly, so the thread never has to infer it from the URL.

/** What the agent can actually do — one card per real capability, no aspiration.
    Mirrors the tools in lib/agent/tools.ts plus the retrieval it always runs.
    Each card starts the work it names: a capability whose prompt is already a
    complete request `ask`s it outright; one that needs a specific from the
    builder `draft`s the opening of the sentence into the hero input instead of
    guessing at what they meant. */
export type Capability = {
  id: string;
  icon: LucideIcon;
  title: string;
  detail: string;
  // "ask" starts a thread; "draft" pre-fills the hero; "navigate" leaves the hub
  // for a route (e.g. the PRD wizard) instead of talking to the agent.
  mode: "ask" | "draft" | "navigate";
  prompt: (clientName: string) => string;
};

export const CAPABILITIES: Capability[] = [
  {
    id: "summarize",
    icon: Briefcase,
    title: "Summarize a client",
    detail: "Where the engagement stands",
    mode: "ask",
    prompt: (c) => `Summarize where ${c} stands right now.`,
  },
  {
    id: "create-task",
    icon: ListPlus,
    title: "Create a task",
    detail: "Add it to the build board",
    mode: "draft",
    prompt: (c) => `Create a task for ${c} to `,
  },
  {
    id: "move-task",
    icon: ListChecks,
    title: "Move a task",
    detail: "Update its status on the board",
    mode: "draft",
    prompt: () => "Move the task ",
  },
  {
    id: "sort-tasks",
    icon: ArrowUpDown,
    title: "Sort tasks",
    detail: "Reprioritize the board order",
    mode: "draft",
    prompt: () => "Sort the tasks so ",
  },
  {
    id: "send-approval",
    icon: Send,
    title: "Send for approval",
    detail: "Push a task to the operator",
    mode: "draft",
    prompt: () => "Send the task ",
  },
  {
    id: "reason",
    icon: Brain,
    title: "Reason over context",
    detail: "Docs, tasks, timeline, code",
    mode: "draft",
    prompt: () => "What do we know about ",
  },
  {
    id: "draft-prd",
    icon: FileText,
    title: "Draft a PRD",
    detail: "Generates in the background",
    mode: "navigate",
    prompt: () => "",
  },
  {
    id: "edit-doc",
    icon: FilePenLine,
    title: "Edit a document",
    detail: "Change a PRD, quote, or contract",
    mode: "draft",
    prompt: () => "Edit the ",
  },
];

// Which capabilities lead per page — the SAME cards, reordered so the section's
// most likely action sits first. Ids omitted here keep their canonical position
// after the leaders (Array.sort is stable, so equal ranks preserve order).
const CAPABILITY_ORDER: Record<BuilderSection, string[]> = {
  tasks: ["create-task", "move-task", "sort-tasks", "send-approval"],
  documents: ["draft-prd", "edit-doc", "reason", "summarize"],
  clients: ["summarize", "reason", "create-task"],
  repo: ["reason", "summarize", "move-task"],
  agent: [],
  general: [],
};

/** CAPABILITIES reordered for the section — leads with that page's most likely
    actions, keeps the rest in canonical order. Returns the shared array untouched
    for sections with no lean, so callers can pass it straight to a stable list. */
export function capabilitiesFor(section: BuilderSection): Capability[] {
  const lead = CAPABILITY_ORDER[section];
  if (!lead.length) return CAPABILITIES;
  const rank = (id: string) => {
    const i = lead.indexOf(id);
    return i === -1 ? lead.length : i;
  };
  return [...CAPABILITIES].sort((a, b) => rank(a.id) - rank(b.id));
}

/** The New PRD wizard for a project, or the projects list when there's no project
    in scope yet — the "Draft a PRD" capability's destination. */
export function draftPrdHref(projectId: string | null | undefined): string {
  return projectId ? `/b/projects/${projectId}/prd/new` : "/b/projects";
}

const JUMP_ICON: Record<string, LucideIcon> = {
  "nav-b-tasks": ListChecks,
  "nav-b-engagements": Briefcase,
  "nav-b-projects": FileText,
  "nav-b-repo": GitBranch,
  "nav-b-profile": UserRound,
};

const JUMP_TO = JUMP_TO_IDS.map((id) => BUILDER_NAV.find((n) => n.id === id)).filter(
  (n): n is (typeof BUILDER_NAV)[number] => !!n
);

/**
 * Typewriter hint overlaid on the empty hero input — mirrors the toolbar's
 * rotating placeholder, leaning toward the page in view. Rendered only while the
 * input is empty; under prefers-reduced-motion it holds a stable, caret-free
 * label instead. Phrases come from the shared section-prompts module.
 */
function HeroHint({ section, clientName }: { section: BuilderSection; clientName: string }) {
  const phrases = React.useMemo(() => krowecanFor(section, clientName), [section, clientName]);
  const { text, reduced } = useTypewriter(phrases);

  if (reduced) {
    return (
      <span className="krowe-ah-input-hint" aria-hidden="true">
        {reducedHint(section, clientName)}
      </span>
    );
  }

  return (
    <span className="krowe-ah-input-hint" aria-hidden="true">
      {text}
      <span className="krowe-tb-caret">▍</span>
    </span>
  );
}

function runStatusLabel(status: AgentRunStatus): string {
  switch (status) {
    case "thinking":
      return "Thinking";
    case "running_tool":
      return "Working";
    case "awaiting_input":
      return "Needs you";
    case "done":
      return "Done";
    case "error":
      return "Error";
    default:
      return "Idle";
  }
}

function StatusBadge({ status }: { status: AgentRunStatus }) {
  return (
    <span className="krowe-agent-badge" data-status={status}>
      {runStatusLabel(status)}
    </span>
  );
}

export function AgentConsole({
  initialQuery,
  initialCapability,
  initialEngagementId,
  variant = "palette",
  onBack,
  onClose,
}: {
  initialQuery?: string;
  /** A capability id (see CAPABILITIES) to fire once the client resolves — set
      when the builder picks one from the toolbar dropdown's "Krowe can" list. */
  initialCapability?: string;
  /** Scope the hub to a specific client on mount — the full page's ?client=.
      Falls back to the path/default the same way the palette does. */
  initialEngagementId?: string | null;
  /** "palette" hosts the hub inside ⌘K; "page" frames it as the full-screen
      /b/agent destination (card shell, no palette-only esc affordances) and
      hands the thread the page variant so it never routes to a second window. */
  variant?: "palette" | "page";
  onBack?: () => void;
  /** Closes the whole palette — used when the thread routes to the workspace. */
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const isPage = variant === "page";
  // The full page seeds its own scope; the palette derives it from the client
  // page it opened over. Either resolves to the hub default when null.
  const scopeId = initialEngagementId ?? pathname?.match(ENGAGEMENT_PATH)?.[1] ?? null;
  // The page the builder opened the hub over — steers the placeholder, "Try
  // asking" rows, and capability order toward what they're most likely after.
  const section = resolveBuilderSection(pathname);

  const [engagements, setEngagements] = React.useState<AgentHubEngagement[] | null>(null);
  const [engagementId, setEngagementId] = React.useState<string | null>(null);
  const [runs, setRuns] = React.useState<AgentRun[]>([]);
  const [summary, setSummary] = React.useState<EngagementContextSummary | null>(null);
  const [switcherOpen, setSwitcherOpen] = React.useState(false);
  const [runsOpen, setRunsOpen] = React.useState(false);
  const [input, setInput] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  // The active conversation. `null` → the hub. A fresh ask carries `query`; a
  // resumed one carries `runId`. `nonce` remounts the thread per ask.
  const [active, setActive] = React.useState<{
    runId: string | null;
    query?: string;
    nonce: number;
  } | null>(initialQuery ? { runId: null, query: initialQuery, nonce: 0 } : null);

  const heroRef = React.useRef<HTMLInputElement>(null);

  const clientName = engagements?.find((e) => e.id === engagementId)?.title || "this client";
  const noClients = engagements !== null && engagements.length === 0;

  // The Context row's chips, ordered by what the builder would miss least — the
  // tail is what collapses when the row runs out of width. The client itself
  // leads and realistically never collapses; `repo` is the first to go.
  const contextPills = React.useMemo<OverflowPill[]>(() => {
    const pills: OverflowPill[] = [
      {
        key: "client",
        node: (
          <span className="krowe-ah-chip">
            <Briefcase size={13} />
            {engagements === null ? "Loading…" : clientName}
          </span>
        ),
      },
    ];
    if (!summary) return pills;

    pills.push({
      key: "documents",
      node: (
        <span className="krowe-ah-chip">
          <FileText size={13} />
          {summary.documents} document{summary.documents === 1 ? "" : "s"}
        </span>
      ),
    });
    pills.push({
      key: "tasks",
      node: (
        <span className="krowe-ah-chip">
          <ListChecks size={13} />
          Build Board · {summary.tasks} task{summary.tasks === 1 ? "" : "s"}
        </span>
      ),
    });
    if (summary.repoConnected) {
      pills.push({
        key: "repo",
        node: (
          <span className="krowe-ah-chip">
            <GitBranch size={13} />
            repo
          </span>
        ),
      });
    }
    return pills;
  }, [engagements, clientName, summary]);

  // Which client the runs/summary in state belong to. Lets the switch effect
  // below skip a client the hub load already covered — and re-fetch one it
  // covered *earlier* but has since been switched away from and back to.
  const loadedFor = React.useRef<string | null>(null);
  // Set once the builder picks a client by hand. A revalidation landing after
  // that must not yank them back to the client the hub defaulted to.
  const userPicked = React.useRef(false);

  // Open the hub: clients + scoped client + its recents and counts, in one hop.
  // Normally free — the toolbar warmed this scope on mount (see GlobalSearch),
  // so peekHub answers and the whole Context row paints on the opening frame.
  // The revalidation behind it dedupes against a warm-up still in flight rather
  // than racing it with a second identical request.
  React.useEffect(() => {
    let alive = true;
    const key = hubKey(scopeId);

    const applyHub = (hub: AgentHubData) => {
      setEngagements(hub.engagements);
      setEngagementId(hub.engagementId);
      setRuns(hub.runs);
      setSummary(hub.summary);
      loadedFor.current = hub.engagementId;
    };

    const cached = peekHub(key);
    if (cached) applyHub(cached);

    void loadHub(key)
      .then((hub) => {
        if (!alive) return;
        // Revalidation is behind the builder now — refresh the client list (the
        // switcher reads it) but leave their chosen scope and its data alone.
        if (userPicked.current) {
          setEngagements(hub.engagements);
          return;
        }
        applyHub(hub);
      })
      .catch(() => {
        // Leave whatever's painted. A cache hit stays usable; a cold open stays
        // on "Loading…", which is what it showed before this failed.
      });

    return () => {
      alive = false;
    };
  }, [scopeId]);

  // Scope changed to a client whose data isn't in state → drop the thread and
  // pull that client's recents and counts. Deliberately the same one-hop payload
  // the hub opens on rather than a pair of narrower actions: it's one round trip
  // instead of two, and it fills the shared cache, so switching back to a client
  // — or later landing on its page — costs nothing.
  React.useEffect(() => {
    if (!engagementId) return;
    if (loadedFor.current === engagementId) return;
    setActive(null);
    setError(null);
    let alive = true;
    const key = hubKey(engagementId);

    const cached = peekHub(key);
    if (cached) {
      setRuns(cached.runs);
      setSummary(cached.summary);
      loadedFor.current = engagementId;
    } else {
      setSummary(null);
    }

    void loadHub(key)
      .then((hub) => {
        if (!alive) return;
        setRuns(hub.runs);
        setSummary(hub.summary);
        loadedFor.current = engagementId;
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, [engagementId]);

  React.useEffect(() => {
    if (active) return;
    const t = setTimeout(() => heroRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, [active]);

  // A capability chosen from the toolbar dropdown opens the hub already carrying
  // that intent. Fire it once the client is resolved (ask ones start a thread,
  // draft ones pre-fill the hero), then never again for this mount.
  const capabilityFired = React.useRef(false);
  React.useEffect(() => {
    if (!initialCapability || capabilityFired.current || !engagementId) return;
    const cap = CAPABILITIES.find((c) => c.id === initialCapability);
    if (!cap) return;
    capabilityFired.current = true;
    runCapability(cap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCapability, engagementId]);

  const refreshRuns = React.useCallback(() => {
    if (engagementId) void listAgentRuns(engagementId).then(setRuns);
  }, [engagementId]);

  function ask(text: string) {
    const q = text.trim();
    if (!q || !engagementId) return;
    setInput("");
    setActive((a) => ({ runId: null, query: q, nonce: (a?.nonce ?? 0) + 1 }));
  }

  // Hand the builder a half-written sentence and the caret at the end of it, so
  // the only thing left to supply is the part only they know.
  function draft(text: string) {
    if (!engagementId) return;
    setInput(text);
    requestAnimationFrame(() => {
      const el = heroRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }

  function runCapability(c: Capability) {
    if (c.mode === "navigate") {
      if (c.id === "draft-prd") {
        const projectId = engagements?.find((e) => e.id === engagementId)?.projectId ?? null;
        go(draftPrdHref(projectId));
      }
      return;
    }
    const prompt = c.prompt(clientName);
    if (c.mode === "ask") ask(prompt);
    else draft(prompt);
  }

  function openRun(id: string) {
    setRunsOpen(false);
    setActive((a) => ({ runId: id, nonce: (a?.nonce ?? 0) + 1 }));
  }

  function newRun() {
    setRunsOpen(false);
    setActive(null);
  }

  async function removeRun(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const res = await deleteAgentRun(id);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setRuns((prev) => prev.filter((r) => r.id !== id));
    if (active?.runId === id) newRun();
  }

  function go(href: string) {
    onClose?.();
    router.push(href);
  }

  // ── Active conversation (directions B + C) ──────────────────────────────
  if (active && engagementId) {
    return (
      <div className={isPage ? "krowe-ah krowe-ah-page" : "krowe-ah"}>
        <div className="krowe-ah-head">
          <button
            type="button"
            className="krowe-agent-back"
            onClick={() => setActive(null)}
            aria-label="Back to the agent hub"
          >
            <ArrowLeft size={16} />
          </button>
          <span className="krowe-ah-head-client">
            <Briefcase size={13} />
            {clientName}
          </span>
          <div className="krowe-agent-head-right">
            <div className="krowe-agent-runs-wrap">
              <button
                type="button"
                className="krowe-agent-runsbtn"
                onClick={() => setRunsOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={runsOpen}
              >
                History
                <ChevronDown size={14} />
              </button>
              {runsOpen && (
                <>
                  <div className="krowe-agent-runs-scrim" onClick={() => setRunsOpen(false)} />
                  <div className="krowe-agent-runs" role="menu">
                    {runs.length === 0 && (
                      <div className="krowe-agent-runs-empty">No conversations yet</div>
                    )}
                    {runs.map((r) => (
                      <div key={r.id} className="krowe-agent-run" data-active={r.id === active.runId}>
                        <button
                          type="button"
                          role="menuitem"
                          className="krowe-agent-run-main"
                          onClick={() => openRun(r.id)}
                        >
                          <span className="krowe-agent-run-title">{r.title}</span>
                          <StatusBadge status={r.status} />
                        </button>
                        <button
                          type="button"
                          className="krowe-agent-run-del"
                          aria-label="Delete conversation"
                          onClick={(e) => void removeRun(r.id, e)}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
            <button type="button" className="krowe-agent-new" onClick={newRun}>
              <Plus size={15} />
              New
            </button>
          </div>
        </div>

        <AgentThread
          key={`${engagementId}-${active.nonce}`}
          engagementId={engagementId}
          clientName={clientName}
          initialRunId={active.runId}
          initialQuery={active.query}
          variant={variant}
          onRunCreated={refreshRuns}
          onNavigate={onClose}
        />
      </div>
    );
  }

  // ── The hub (direction A) ───────────────────────────────────────────────
  return (
    <div className={isPage ? "krowe-ah krowe-ah-page" : "krowe-ah"}>
      <div className="krowe-ah-hero">
        <div className="krowe-ah-hero-row">
          {onBack && (
            <button
              type="button"
              className="krowe-agent-back"
              onClick={onBack}
              aria-label="Search instead"
            >
              <ArrowLeft size={16} />
            </button>
          )}
          <span className="krowe-ah-ember" data-size="lg">
            <Ember size={17} animated />
          </span>
          <span className="krowe-ah-input-wrap">
            <input
              ref={heroRef}
              className="krowe-ah-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  ask(input);
                }
              }}
              // The animated hint below carries the empty-state copy; the real
              // placeholder only speaks when there's no client to rotate for.
              placeholder={noClients ? "Invite a client to begin" : ""}
              disabled={!engagementId}
              aria-label="Ask the agent"
              autoComplete="off"
              spellCheck={false}
            />
            {!noClients && !input && <HeroHint section={section} clientName={clientName} />}
          </span>
          <button
            type="button"
            className="krowe-ah-send"
            onClick={() => ask(input)}
            disabled={!input.trim() || !engagementId}
            aria-label="Ask the agent"
          >
            <ArrowUp size={18} />
          </button>
        </div>

        <div className="krowe-ah-ctx">
          <span className="krowe-ah-ctx-label">Context</span>
          {noClients ? (
            <span className="krowe-ah-chip">No clients yet</span>
          ) : (
            <OverflowPills
              items={contextPills}
              label="context chips"
              pinned={
                <div className="krowe-ah-switch-wrap">
                  <button
                    type="button"
                    className="krowe-ah-chip krowe-ah-chip-edit"
                    onClick={() => setSwitcherOpen((o) => !o)}
                    aria-haspopup="menu"
                    aria-expanded={switcherOpen}
                    disabled={engagements === null}
                  >
                    <SlidersHorizontal size={13} />
                    Edit
                  </button>
                  {switcherOpen && (
                    <>
                      <div
                        className="krowe-agent-runs-scrim"
                        onClick={() => setSwitcherOpen(false)}
                      />
                      <div className="krowe-ah-switch" role="menu">
                        {engagements?.map((e) => (
                          <button
                            key={e.id}
                            type="button"
                            role="menuitem"
                            className="krowe-ah-switch-item"
                            data-active={e.id === engagementId}
                            onClick={() => {
                              userPicked.current = true;
                              setEngagementId(e.id);
                              setSwitcherOpen(false);
                            }}
                          >
                            <Briefcase size={14} />
                            {e.title || "Client"}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              }
            />
          )}
        </div>
      </div>

      <div className="krowe-ah-body">
        {error && (
          <div className="krowe-agent-error" role="alert">
            {error}
          </div>
        )}

        <div className="krowe-ah-sec">Krowe can</div>
        <div className="krowe-ah-grid">
          {capabilitiesFor(section).map((c) => {
            const Icon = c.icon;
            return (
              <button
                key={c.title}
                type="button"
                className="krowe-ah-cap"
                onClick={() => runCapability(c)}
                disabled={!engagementId}
              >
                <span className="krowe-ah-cap-ic">
                  <Icon size={17} />
                </span>
                <span className="krowe-ah-cap-tx">
                  <span className="krowe-ah-cap-t">{c.title}</span>
                  <span className="krowe-ah-cap-d">{c.detail}</span>
                </span>
              </button>
            );
          })}
        </div>

        {!noClients && (
          <>
            <div className="krowe-ah-sec">Try asking</div>
            {suggestionsFor(section, clientName).map((s) => (
              <button
                key={s}
                type="button"
                className="krowe-ah-row"
                onClick={() => ask(s)}
                disabled={!engagementId}
              >
                <span className="krowe-ah-row-ic">
                  <Sparkles size={16} />
                </span>
                <span className="krowe-ah-row-t">{s}</span>
              </button>
            ))}
          </>
        )}

        {runs.length > 0 && (
          <>
            <div className="krowe-ah-sec">Pick up where you left off</div>
            {runs.slice(0, 3).map((r) => (
              <button key={r.id} type="button" className="krowe-ah-row" onClick={() => openRun(r.id)}>
                <span className="krowe-ah-row-ic">
                  <MessageSquare size={16} />
                </span>
                <span className="krowe-ah-row-t">{r.title}</span>
                <span className="krowe-ah-row-meta">{relativeTime(r.updatedAt)}</span>
              </button>
            ))}
          </>
        )}

        <div className="krowe-ah-sec">Jump to</div>
        <div className="krowe-ah-jump">
          {JUMP_TO.map((n) => {
            const Icon = JUMP_ICON[n.id] ?? ListChecks;
            return (
              <button key={n.id} type="button" className="krowe-ah-pill" onClick={() => go(n.href)}>
                <Icon size={15} />
                {n.title}
              </button>
            );
          })}
        </div>
      </div>

      <div className="krowe-ah-foot">
        <span>
          <span className="k">↵</span>ask
        </span>
        {!isPage && (
          <span>
            <span className="k">esc</span>
            {onBack ? "search" : "close"}
          </span>
        )}
      </div>
    </div>
  );
}
