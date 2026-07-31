"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowUp,
  ArrowRight,
  ArrowRightLeft,
  ArrowUpDown,
  AudioLines,
  CalendarClock,
  Check,
  CircleCheck,
  CornerDownRight,
  FileCode,
  FileText,
  FolderInput,
  FolderPlus,
  Link2,
  ListChecks,
  ListPlus,
  Loader,
  Paperclip,
  PanelRightOpen,
  Pencil,
  Plus,
  Replace,
  Send,
  Server,
  Sparkles,
  StickyNote,
  Trash2,
  Undo2,
  UserRound,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Ember } from "@/components/design-atoms";
import { AgentTaskBoard } from "@/components/agent/task-widget";
import { AgentPrdWidget } from "@/components/agent/prd-widget";
import { useAgentRun, useAgentRunsApi } from "@/components/agent/agent-runs-provider";
import { confirmToolCall, createAgentRun, getAgentRun, rejectToolCall } from "@/lib/actions/agent";
import { publishDocEdit } from "@/lib/agent/doc-events";
import { PROJECT_PATH, resolveBuilderSection, resolveViewedDoc, sectionLabel } from "@/lib/nav-commands";
import { sectionForViewedDoc } from "@/lib/prd/viewed-section";
import type {
  AgentMessage,
  AgentRun,
  AgentSource,
  AgentToolCall,
  AgentWidget,
} from "@/lib/agent/types";

// The conversation half of the agent — the thread, the composer, and the
// streaming/confirm state machine. Hosted in two places, which is the whole
// reason it's extracted: the ⌘K palette (agent-console.tsx, which wraps it in
// the Agent Hub entry) and the full-page workspace (/b/agent/[runId]), which
// seeds it from the server with zero client round-trip.
//
// It renders two of the Agent Hub design's directions:
//   B — the answer: serif lead, "Reasoned over" source chips, follow-up bar.
//   C — the work: a live step list driven by real stream events, plus the
//       hand-off to the full workspace.

export interface UIMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: AgentSource[];
  widgets?: AgentWidget[];
  toolCalls?: AgentToolCall[] | null;
  toolStatus?: string | null;
  toolResults?: string[];
}

/** Server rows → thread bubbles. Tool rows are internal and never rendered. */
export function toUIMessages(messages: AgentMessage[]): UIMessage[] {
  return messages
    .filter((m) => m.role !== "tool")
    .map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.content,
      sources: m.sources ?? undefined,
      widgets: m.widgets ?? undefined,
      toolCalls: m.toolCalls ?? undefined,
      toolStatus: m.toolStatus ?? undefined,
    }));
}

/** Context-item kinds the retrieval layer can cite (lib/types.ts ContextItemKind). */
const KIND_ICON: Record<string, LucideIcon> = {
  task: ListChecks,
  milestone: ListChecks,
  transcript: AudioLines,
  codebase: FileCode,
  profile: UserRound,
  link: Link2,
  material: Paperclip,
  task_attachment: Paperclip,
  note: StickyNote,
  infra: Server,
  availability: CalendarClock,
};

/** How many source chips to show before collapsing the tail into a "+N" chip. */
const MAX_SOURCE_CHIPS = 6;

/** Human-readable summary of a proposed tool call for the confirmation card.
    Exported so the topbar queue's inline approval strip (agent-run-dock) reads a
    proposal identically to the thread. */
export function describeToolCall(tc: AgentToolCall): string {
  const a = tc.arguments ?? {};
  const taskTitle = typeof a.taskTitle === "string" ? a.taskTitle : "task";
  if (tc.name === "create_task") {
    const title = typeof a.title === "string" ? a.title : "task";
    return `Create task: “${title}”`;
  }
  if (tc.name === "update_task_status") {
    const status = typeof a.status === "string" ? a.status.replace("_", " ") : "";
    return `Move “${taskTitle}” → ${status}`;
  }
  if (tc.name === "edit_task") {
    const fields = ["title", "description", "priority", "type", "estimateHours"]
      .filter((f) => a[f] != null && a[f] !== "")
      .map((f) => (f === "estimateHours" ? "estimate" : f));
    return `Edit “${taskTitle}”${fields.length ? `: ${fields.join(", ")}` : ""}`;
  }
  if (tc.name === "delete_task") return `Delete “${taskTitle}”`;
  if (tc.name === "reorder_tasks") {
    const n = Array.isArray(a.orderedTaskTitles) ? a.orderedTaskTitles.length : 0;
    return `Reorder ${n} task${n === 1 ? "" : "s"}`;
  }
  if (tc.name === "mark_task_done") return `Mark “${taskTitle}” done`;
  if (tc.name === "send_task_for_approval") return `Send “${taskTitle}” for approval`;
  if (tc.name === "withdraw_task_approval") return `Withdraw “${taskTitle}” from approval`;
  if (tc.name === "add_subtask") {
    const sub = typeof a.subtaskTitle === "string" ? a.subtaskTitle : "subtask";
    return `Add subtask “${sub}” to “${taskTitle}”`;
  }
  if (tc.name === "toggle_subtask") {
    const sub = typeof a.subtaskTitle === "string" ? a.subtaskTitle : "subtask";
    return `${a.completed === true ? "Check off" : "Reopen"} “${sub}”`;
  }
  if (tc.name === "generate_subtasks") return `Generate subtasks for “${taskTitle}”`;
  if (tc.name === "assign_staging_group") {
    const g = typeof a.groupName === "string" ? a.groupName : "group";
    return g.toLowerCase() === "none"
      ? `Clear staging group on “${taskTitle}”`
      : `File “${taskTitle}” under “${g}”`;
  }
  if (tc.name === "create_staging_group") {
    const name = typeof a.name === "string" ? a.name : "group";
    return `Create staging group “${name}”`;
  }
  if (tc.name === "swap_prd_tech") {
    const from = typeof a.from === "string" ? a.from : "";
    const to = typeof a.to === "string" ? a.to : "";
    return from && to ? `Swap “${from}” → “${to}” in the PRD` : "Swap a technology in the PRD";
  }
  return tc.name.replace(/_/g, " ");
}

export function ToolIcon({ name }: { name: string }) {
  if (name === "create_task") return <ListPlus size={15} />;
  if (name === "update_task_status") return <ArrowRightLeft size={15} />;
  if (name === "edit_task") return <Pencil size={15} />;
  if (name === "delete_task") return <Trash2 size={15} />;
  if (name === "reorder_tasks") return <ArrowUpDown size={15} />;
  if (name === "mark_task_done") return <CircleCheck size={15} />;
  if (name === "send_task_for_approval") return <Send size={15} />;
  if (name === "withdraw_task_approval") return <Undo2 size={15} />;
  if (name === "add_subtask") return <Plus size={15} />;
  if (name === "toggle_subtask") return <ListChecks size={15} />;
  if (name === "generate_subtasks") return <Wand2 size={15} />;
  if (name === "assign_staging_group") return <FolderInput size={15} />;
  if (name === "create_staging_group") return <FolderPlus size={15} />;
  if (name === "swap_prd_tech") return <Replace size={15} />;
  return <Sparkles size={15} />;
}

/**
 * Where the current turn is, derived only from events the engine actually
 * emits — never a fabricated timeline. `reading` on send, `searching` when a
 * read tool runs, `composing` once retrieval yields sources.
 */
type TurnPhase = "reading" | "searching" | "composing";
type StepState = "done" | "now" | "wait";

function StepIcon({ state }: { state: StepState }) {
  if (state === "done")
    return (
      <span className="krowe-ah-sic" data-state="done">
        <Check size={13} />
      </span>
    );
  if (state === "now")
    return (
      <span className="krowe-ah-sic" data-state="now">
        <Loader size={13} />
      </span>
    );
  return <span className="krowe-ah-sic" data-state="wait" />;
}

const PHASE_LEAD: Record<TurnPhase, string> = {
  reading: "Working through it — reading the context first.",
  searching: "Working through it — searching the context.",
  composing: "Working through it — composing your answer.",
};

function WorkingSteps({ phase, clientName }: { phase: TurnPhase; clientName: string }) {
  const steps: { label: string; state: StepState }[] = [
    { label: `Reading ${clientName}'s context`, state: phase === "reading" ? "now" : "done" },
    {
      label: "Searching context",
      state: phase === "reading" ? "wait" : phase === "searching" ? "now" : "done",
    },
    { label: "Composing answer", state: phase === "composing" ? "now" : "wait" },
  ];

  return (
    <div className="krowe-ah-work">
      <div className="krowe-ah-work-lead">
        <span className="krowe-ah-ember" data-size="sm">
          <Ember size={15} animated />
        </span>
        {PHASE_LEAD[phase]}
      </div>
      <div className="krowe-ah-steps">
        {steps.map((s) => (
          <div key={s.label} className="krowe-ah-step" data-state={s.state}>
            <StepIcon state={s.state} />
            <span className="krowe-ah-step-t">{s.label}</span>
            {s.state !== "wait" && (
              <span className="krowe-ah-step-meta">{s.state === "done" ? "done" : "now"}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReasonedOver({ sources }: { sources: AgentSource[] }) {
  const shown = sources.slice(0, MAX_SOURCE_CHIPS);
  const rest = sources.length - shown.length;
  return (
    <div className="krowe-ah-src">
      <span className="krowe-ah-src-lbl">Reasoned over</span>
      {shown.map((s, i) => {
        const Icon = KIND_ICON[s.kind] ?? FileText;
        return (
          <span
            key={`${s.title}-${i}`}
            className="krowe-ah-chip"
            title={`${s.kind.replace(/_/g, " ")} · ${s.similarity.toFixed(2)} similarity`}
          >
            <Icon size={13} />
            {s.title}
          </span>
        );
      })}
      {rest > 0 && (
        <span className="krowe-ah-chip" title={sources.slice(MAX_SOURCE_CHIPS).map((s) => s.title).join("\n")}>
          +{rest} more
        </span>
      )}
    </div>
  );
}

export function AgentThread({
  engagementId,
  clientName,
  initialRunId = null,
  initialMessages,
  initialQuery,
  autoFocus = true,
  variant = "palette",
  onRunCreated,
  onNavigate,
}: {
  engagementId: string;
  clientName: string;
  initialRunId?: string | null;
  initialMessages?: UIMessage[];
  initialQuery?: string;
  autoFocus?: boolean;
  variant?: "palette" | "page";
  onRunCreated?: (run: AgentRun) => void;
  /** Host hook fired before routing away (the palette closes itself). */
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const api = useAgentRunsApi();
  const [runId, setRunId] = React.useState<string | null>(initialRunId);
  const [messages, setMessages] = React.useState<UIMessage[]>(initialMessages ?? []);
  const [input, setInput] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  // The live turn for this thread's run, owned by the global provider (so this
  // thread unmounting no longer aborts it). Present only while a turn is in flight
  // or just finished, pre-eviction.
  const run = useAgentRun(runId);
  const busy = !!run && (run.streaming || run.status === "thinking" || run.status === "running_tool");

  // Rehydrate a past run the host handed us by id alone (the palette's recents).
  // The page seeds initialMessages from the server, so it skips this entirely.
  const hydratedRef = React.useRef(false);
  React.useEffect(() => {
    if (!initialRunId || initialMessages || hydratedRef.current) return;
    hydratedRef.current = true;
    let alive = true;
    void (async () => {
      const res = await getAgentRun(initialRunId);
      if (!alive) return;
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setMessages(toUIMessages(res.messages));
    })();
    return () => {
      alive = false;
    };
  }, [initialRunId, initialMessages]);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, run?.streamingContent, run?.status]);

  React.useEffect(() => {
    if (!autoFocus) return;
    // preventScroll: the palette hosts this in a non-sticky topbar popover, so
    // scrolling the composer into view would yank the whole bar off-screen.
    const t = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 40);
    return () => clearTimeout(t);
  }, [autoFocus]);

  // Fold a finished turn into the durable message list exactly once (keyed by its
  // DB id) so it persists after the provider evicts the live run; surface errors
  // as the thread's banner. A proposal commits with its tool calls so the confirm
  // gate below keeps working.
  React.useEffect(() => {
    if (!run) return;
    if (run.status === "error") {
      if (run.error) setError(run.error);
      return;
    }
    const terminal = run.status === "done" || run.status === "awaiting_input";
    if (!terminal || !run.finalMessageId) return;
    const proposing = run.status === "awaiting_input";
    const committed: UIMessage = {
      id: run.finalMessageId,
      role: "assistant",
      content: run.streamingContent,
      sources: run.sources.length ? run.sources : undefined,
      widgets: run.widgets.length ? run.widgets : undefined,
      toolCalls: proposing ? run.toolCalls ?? undefined : undefined,
      toolStatus: proposing ? "proposed" : undefined,
    };
    // Idempotent: the DB id keys the committed row, so a re-run of this effect
    // (deltas fire it repeatedly) never double-appends.
    setMessages((prev) => (prev.some((m) => m.id === committed.id) ? prev : [...prev, committed]));
  }, [run]);

  // `text` lets callers (the seed effect) pass the message explicitly instead of
  // waiting for the async `setInput` to flush — avoids a stale-state race.
  const send = React.useCallback(
    async (text?: string) => {
      const content = (text ?? input).trim();
      if (!content || busy || !engagementId) return;
      setError(null);
      setInput("");

      let activeRun = runId;
      if (!activeRun) {
        const res = await createAgentRun(engagementId, content);
        if ("error" in res) {
          setError(res.error);
          return;
        }
        activeRun = res.run.id;
        setRunId(activeRun);
        onRunCreated?.(res.run);
      }

      setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", content }]);

      // Hand the turn to the global provider — it owns the SSE, so this thread
      // unmounting (palette close, navigation) no longer stops the run, and the
      // live bubble below is driven from provider state.
      // Page context is resolved from the current path, but the run remembers it
      // server-side (sticky, like projectId) — so a follow-up sent from the
      // neutral agent workspace, where these resolve to null, inherits the page
      // the chat started on rather than dropping it.
      const viewedDoc = resolveViewedDoc(pathname);
      api.startRun({
        runId: activeRun,
        engagementId,
        projectId: pathname?.match(PROJECT_PATH)?.[1] ?? null,
        viewedDoc,
        viewedSection: sectionForViewedDoc(viewedDoc),
        clientName,
        title: content.split("\n")[0].slice(0, 60),
        message: content,
        page: sectionLabel(resolveBuilderSection(pathname)) ?? undefined,
      });

      inputRef.current?.focus({ preventScroll: true });
    },
    [api, busy, clientName, engagementId, input, onRunCreated, pathname, runId]
  );

  // Auto-send the query the builder typed in the omnibox. Fires once per mount;
  // hosts remount (via key) for each new ask, so the ref is fresh.
  const seededRef = React.useRef(false);
  React.useEffect(() => {
    if (!initialQuery || !engagementId || seededRef.current) return;
    seededRef.current = true;
    void send(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery, engagementId]);

  /** Detach this client from the turn. It still finishes + persists server-side. */
  const stop = React.useCallback(() => {
    if (runId) api.stopRun(runId);
  }, [api, runId]);

  const openWorkspace = React.useCallback(() => {
    if (!runId) return;
    onNavigate?.();
    router.push(`/b/agent/${runId}`);
  }, [onNavigate, router, runId]);

  // ⌘. stops the turn. The composer is disabled mid-stream, so this can't live
  // on its keydown — it has to be a window listener.
  React.useEffect(() => {
    if (!busy) return;
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === ".") {
        e.preventDefault();
        stop();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, stop]);

  async function confirmProposal(messageId: string) {
    setError(null);
    setBusyId(messageId);
    const res = await confirmToolCall(messageId);
    setBusyId(null);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId ? { ...m, toolStatus: "executed", toolResults: res.results } : m
      )
    );
    // The server settled the run to `done` when the tool ran — tell the provider so
    // the queue ring stops nagging "needs you" and fades on the normal linger.
    if (runId) api.resolveRun(runId);
    // If the agent just edited a document, tell any open view of it to update
    // live — no reload (lib/agent/doc-events.ts).
    for (const edit of res.docEdits) publishDocEdit(edit);
  }

  async function rejectProposal(messageId: string) {
    setError(null);
    setBusyId(messageId);
    const res = await rejectToolCall(messageId);
    setBusyId(null);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, toolStatus: "rejected" } : m)));
    // rejectToolCall also settles the run to `done` — clear the "needs you" ring.
    if (runId) api.resolveRun(runId);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      // ⌘↵ — open the full thread rather than send (design direction B).
      if (variant === "palette" && runId) {
        e.preventDefault();
        openWorkspace();
      }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  const inPalette = variant === "palette";

  // The in-flight bubble comes from the live run until its terminal turn has been
  // folded into `messages` (or errored, which shows as a banner instead).
  const liveCommitted = run?.finalMessageId
    ? messages.some((m) => m.id === run.finalMessageId)
    : false;
  const showLive = !!run && !liveCommitted && run.status !== "error";
  const stepPhase: TurnPhase =
    run?.phase === "searching" ? "searching" : run?.phase === "composing" ? "composing" : "reading";

  return (
    <div className="krowe-ah-thread" data-variant={variant}>
      <div className="krowe-ah-scroll" ref={scrollRef}>
        {!inPalette && messages.length === 0 && !busy && !error && (
          <div className="krowe-agent-empty">
            <span className="krowe-ah-ember" data-size="lg">
              <Ember size={17} />
            </span>
            <p className="krowe-agent-empty-t">Ask about {clientName}</p>
            <p className="krowe-agent-empty-s">
              Grounded in everything you know about them — documents, tasks, timeline, and code.
            </p>
          </div>
        )}

        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="krowe-ah-q">
              <span className="krowe-ah-ember">
                <Ember size={17} />
              </span>
              <span className="krowe-ah-q-t">{m.content}</span>
            </div>
          ) : (
            <div key={m.id} className="krowe-ah-a">
              {m.content ? (
                <div className="krowe-ah-answer krowe-agent-md">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                </div>
              ) : null}

              {m.widgets?.map((w, i) =>
                w.type === "tasks" ? (
                  <AgentTaskBoard key={i} widget={w} />
                ) : w.type === "prd" ? (
                  <AgentPrdWidget key={i} widget={w} />
                ) : null
              )}

              {m.sources && m.sources.length > 0 && <ReasonedOver sources={m.sources} />}

              {m.toolCalls && m.toolCalls.length > 0 && (
                <div className="krowe-agent-proposal" data-status={m.toolStatus ?? "proposed"}>
                  <div className="krowe-agent-proposal-list">
                    {m.toolCalls.map((tc, i) => (
                      <div key={i} className="krowe-agent-proposal-item">
                        <span className="krowe-agent-proposal-ic">
                          <ToolIcon name={tc.name} />
                        </span>
                        <span className="krowe-agent-proposal-desc">{describeToolCall(tc)}</span>
                      </div>
                    ))}
                  </div>
                  {m.toolStatus === "proposed" ? (
                    <div className="krowe-agent-proposal-actions">
                      <button
                        type="button"
                        className="krowe-agent-btn ghost"
                        onClick={() => void rejectProposal(m.id)}
                        disabled={busyId === m.id}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="krowe-agent-btn primary"
                        onClick={() => void confirmProposal(m.id)}
                        disabled={busyId === m.id}
                      >
                        {busyId === m.id ? "Working…" : "Confirm"}
                      </button>
                    </div>
                  ) : m.toolStatus === "executed" ? (
                    <div className="krowe-agent-proposal-done">
                      {(m.toolResults ?? ["Done."]).map((r, i) => (
                        <div key={i} className="krowe-agent-proposal-result">
                          ✓ {r}
                        </div>
                      ))}
                    </div>
                  ) : m.toolStatus === "rejected" ? (
                    <div className="krowe-agent-proposal-cancelled">Cancelled</div>
                  ) : null}
                </div>
              )}
            </div>
          )
        )}

        {/* The in-flight turn, driven by the global provider's run state. */}
        {showLive && (
          <div className="krowe-ah-a">
            {run!.streamingContent ? (
              <div className="krowe-ah-answer krowe-agent-md">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{run!.streamingContent}</ReactMarkdown>
              </div>
            ) : (
              <WorkingSteps phase={stepPhase} clientName={clientName} />
            )}

            {run!.widgets.map((w, i) =>
              w.type === "tasks" ? (
                <AgentTaskBoard key={i} widget={w} />
              ) : w.type === "prd" ? (
                <AgentPrdWidget key={i} widget={w} />
              ) : null
            )}

            {run!.sources.length > 0 && <ReasonedOver sources={run!.sources} />}
          </div>
        )}

        {error && (
          <div className="krowe-agent-error" role="alert">
            {error}
          </div>
        )}

        {/* Direction C — hand off to the workspace while the turn is still running. */}
        {inPalette && busy && runId && (
          <div className="krowe-ah-route">
            <PanelRightOpen size={22} className="krowe-ah-route-ic" />
            <div className="krowe-ah-route-tx">
              <div className="krowe-ah-route-h">This one can keep going.</div>
              <div className="krowe-ah-route-s">
                Open it in a full workspace — more room to read, and your palette stays free.
              </div>
            </div>
            <button type="button" className="krowe-ah-btn" onClick={openWorkspace}>
              Open workspace <ArrowRight size={16} />
            </button>
          </div>
        )}
      </div>

      <div className="krowe-ah-followbar">
        <CornerDownRight size={16} className="krowe-ah-follow-ic" aria-hidden="true" />
        <textarea
          ref={inputRef}
          className="krowe-ah-follow-input"
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`Ask a follow-up about ${clientName}…`}
          disabled={busy}
          aria-label="Message the agent"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          className="krowe-ah-send"
          onClick={() => void send()}
          disabled={!input.trim() || busy}
          aria-label="Send message"
        >
          <ArrowUp size={15} />
        </button>
      </div>

      <div className="krowe-ah-foot">
        <span>
          <span className="k">↵</span>send follow-up
        </span>
        {inPalette && runId && (
          <span>
            <span className="k">⌘↵</span>open full thread
          </span>
        )}
        {busy && (
          <span>
            <span className="k">⌘.</span>stop
          </span>
        )}
        {inPalette && (
          <span className="sp">
            <span className="k">esc</span>close
          </span>
        )}
      </div>
    </div>
  );
}
