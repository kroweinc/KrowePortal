"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Briefcase, ChevronDown } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createAgentRun } from "@/lib/actions/agent";
import { useAgentRunsApiOptional } from "@/components/agent/agent-runs-provider";
import type { AgentDescriptor } from "@/lib/agent/catalog";
import type { HubEngagement, HubProject } from "@/components/agent/agent-hub";

// The launch sheet — a focus-trapped modal (Radix Dialog) that scopes and starts one
// agent. Chat agents pick a client + compose an opening message, then reuse the exact
// createAgentRun → startRun → route path AgentThread.send uses. The PRD agent picks a
// project and hands off to the existing PRD wizard, which queues the durable run. The
// sole Primary in the sheet is the send / "Start draft" button.

interface ScopeOption {
  id: string;
  name: string;
}

export function AgentLaunchSheet({
  descriptor,
  engagements,
  projects,
  onClose,
}: {
  descriptor: AgentDescriptor;
  engagements: HubEngagement[];
  projects: HubProject[];
  onClose: () => void;
}) {
  const router = useRouter();
  const runsApi = useAgentRunsApiOptional();
  const isChat = descriptor.engine === "chat";
  const options: ScopeOption[] = isChat ? engagements : projects;

  const [scopeId, setScopeId] = React.useState<string>(options[0]?.id ?? "");
  const scope = options.find((o) => o.id === scopeId) ?? options[0];
  const clientName = scope?.name ?? "this client";

  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pickOpen, setPickOpen] = React.useState(false);
  const pickRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Seed the composer from the agent's opener, keyed to the chosen client. If the
  // builder hasn't edited it, re-seed when they switch clients; once they type,
  // leave it alone.
  const lastSeed = React.useRef("");
  React.useEffect(() => {
    if (!isChat) return;
    const next = descriptor.seed?.(clientName) ?? "";
    setInput((cur) => (cur === "" || cur === lastSeed.current ? next : cur));
    lastSeed.current = next;
  }, [scopeId, isChat, clientName, descriptor]);

  // Autofocus the composer once the modal is up (Radix has already trapped focus).
  React.useEffect(() => {
    if (isChat) inputRef.current?.focus();
  }, [isChat]);

  // Close the scope popover on an outside click (a fixed scrim would sit behind the
  // z-50 modal, so a ref check is the reliable path here).
  React.useEffect(() => {
    if (!pickOpen) return;
    function onDown(e: MouseEvent) {
      if (pickRef.current && !pickRef.current.contains(e.target as Node)) setPickOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pickOpen]);

  async function launchChat() {
    const message = input.trim();
    if (!message || !scope || busy) return;
    setBusy(true);
    setError(null);
    const res = await createAgentRun(scope.id, message);
    if ("error" in res) {
      setBusy(false);
      setError(res.error);
      return;
    }
    // Same hand-off as AgentThread.send: the provider owns the SSE so the run keeps
    // streaming after this modal unmounts, and it lands in the dock + this feed.
    runsApi?.startRun({
      runId: res.run.id,
      engagementId: scope.id,
      clientName: scope.name,
      title: res.run.title,
      message,
      page: descriptor.page ?? "the Agents Hub",
    });
    onClose();
    router.push(`/b/agent/${res.run.id}`);
  }

  function launchPrd() {
    if (!scope) return;
    onClose();
    // The PRD wizard queues the durable run (queuePrdRun) on its terminal round.
    router.push(`/b/projects/${scope.id}/prd/new`);
  }

  const Icon = descriptor.icon;
  const scopeLabel = isChat ? "Client" : "Project";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="krowe-ls-ic">
              <Icon size={17} />
            </span>
            {descriptor.name}
          </DialogTitle>
          <DialogDescription>{descriptor.blurb}</DialogDescription>
        </DialogHeader>

        <div className="krowe-ls">
          {options.length === 0 ? (
            <div className="krowe-column-empty">
              {isChat
                ? "Invite a client to begin — most agents reason over a client's context."
                : "Create a document first to draft a PRD."}
            </div>
          ) : (
            <>
              <div className="krowe-ls-scope">
                <span className="krowe-ls-scope-lbl">{scopeLabel}</span>
                <div className="krowe-ah-switch-wrap" ref={pickRef}>
                  <button
                    type="button"
                    className="krowe-ah-chip krowe-ah-chip-edit"
                    onClick={() => setPickOpen((o) => !o)}
                    aria-haspopup="menu"
                    aria-expanded={pickOpen}
                  >
                    <Briefcase size={13} />
                    {scope?.name ?? "Choose"}
                    <ChevronDown size={13} />
                  </button>
                  {pickOpen && (
                    <div className="krowe-ah-switch" role="menu">
                      {options.map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          role="menuitem"
                          className="krowe-ah-switch-item"
                          data-active={o.id === scopeId}
                          onClick={() => {
                            setScopeId(o.id);
                            setPickOpen(false);
                          }}
                        >
                          <Briefcase size={14} />
                          {o.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {isChat ? (
                <div className="krowe-ah-hero-row krowe-ls-composer">
                  <span className="krowe-ah-input-wrap">
                    <input
                      ref={inputRef}
                      className="krowe-ah-input"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void launchChat();
                        }
                      }}
                      placeholder="Ask this agent…"
                      aria-label={`Message ${descriptor.name}`}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </span>
                  <button
                    type="button"
                    className="krowe-ah-send"
                    onClick={() => void launchChat()}
                    disabled={!input.trim() || busy}
                    aria-label={`Start ${descriptor.name}`}
                  >
                    <ArrowUp size={18} />
                  </button>
                </div>
              ) : (
                <div className="krowe-ls-actions">
                  <button type="button" className="krowe-ah-btn" onClick={launchPrd} disabled={!scope}>
                    Start draft
                  </button>
                </div>
              )}

              {error && (
                <div className="krowe-agent-error" role="alert">
                  {error}
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
