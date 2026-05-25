"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Check, Copy, FileCode, Hammer, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import Link from "next/link";

import { generateBuildPromptAction } from "@/lib/actions/build-prompt";
import type { AgentVariant, BuildPromptResult } from "@/lib/ai/build-prompt";
import type { Task } from "@/lib/types";

interface Props {
  task: Task;
}

const VARIANTS: { value: AgentVariant; label: string; hint: string }[] = [
  { value: "claude-code", label: "Claude Code", hint: "CLI agent with repo access" },
  { value: "cursor", label: "Cursor", hint: "IDE agent with @-mentions" },
  { value: "chatgpt", label: "ChatGPT", hint: "No repo access — self-contained" },
];

type Saved = {
  variant: AgentVariant;
  result: BuildPromptResult;
  repoFullName: string;
  generatedAt: string;
};

type ErrorInfo = { message: string; needsRepo?: boolean };

type LoadInitState =
  | { kind: "init-loading" }
  | { kind: "ready" };

export function TaskBuildPrompt({ task }: Props) {
  const [variant, setVariant] = useState<AgentVariant>("claude-code");
  const [savedByVariant, setSavedByVariant] = useState<Partial<Record<AgentVariant, Saved>>>({});
  const [initState, setInitState] = useState<LoadInitState>({ kind: "init-loading" });
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [, startTransition] = useTransition();

  // Load all saved prompts for this task on mount / task change.
  useEffect(() => {
    let cancelled = false;
    setSavedByVariant({});
    setError(null);
    setCopied(false);
    setVariant("claude-code");
    setInitState({ kind: "init-loading" });

    fetch(`/api/build-prompts?taskId=${encodeURIComponent(task.id)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((rows: unknown) => {
        if (cancelled) return;
        const next: Partial<Record<AgentVariant, Saved>> = {};
        if (Array.isArray(rows)) {
          for (const row of rows as Array<{
            variant: AgentVariant;
            prompt: string;
            files_referenced: string[] | null;
            notes: string | null;
            repo_full_name: string;
            generated_at: string;
          }>) {
            next[row.variant] = {
              variant: row.variant,
              result: {
                prompt: row.prompt,
                filesReferenced: row.files_referenced ?? [],
                notes: row.notes ?? "",
              },
              repoFullName: row.repo_full_name,
              generatedAt: row.generated_at,
            };
          }
        }
        setSavedByVariant(next);
        setInitState({ kind: "ready" });
      })
      .catch(() => {
        if (cancelled) return;
        setInitState({ kind: "ready" });
      });

    return () => {
      cancelled = true;
    };
  }, [task.id]);

  const generate = useCallback(
    (v: AgentVariant) => {
      setGenerating(true);
      setError(null);
      setCopied(false);
      startTransition(async () => {
        try {
          const res = await generateBuildPromptAction(task.id, v);
          if (res.ok) {
            setSavedByVariant((prev) => ({
              ...prev,
              [v]: {
                variant: v,
                result: res.result,
                repoFullName: res.repoFullName,
                generatedAt: res.generatedAt,
              },
            }));
          } else {
            setError({ message: res.error, needsRepo: res.needsRepo });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Failed to generate";
          setError({ message: msg });
        } finally {
          setGenerating(false);
        }
      });
    },
    [task.id]
  );

  const handleVariantChange = (next: AgentVariant) => {
    if (next === variant) return;
    setVariant(next);
    setError(null);
    setCopied(false);
  };

  const handleCopy = async () => {
    const current = savedByVariant[variant];
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current.result.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  };

  const current = savedByVariant[variant];

  return (
    <section className="krowe-task-section krowe-build-section">
      <div className="krowe-task-section-h">
        <span className="label">
          <Hammer className="h-3 w-3" />
          Build with a coding agent
        </span>
      </div>

      <p className="krowe-build-intro">
        Generate a copy-paste implementation prompt grounded in this task and your linked repo.
        Pick your agent, then click <strong>Generate</strong>. Prompts are saved per agent.
      </p>

      <div className="krowe-build-variants" role="tablist" aria-label="Coding agent">
        {VARIANTS.map((v) => {
          const hasSaved = Boolean(savedByVariant[v.value]);
          return (
            <button
              key={v.value}
              type="button"
              role="tab"
              aria-selected={variant === v.value}
              className={`krowe-build-variant ${variant === v.value ? "active" : ""}`}
              onClick={() => handleVariantChange(v.value)}
              disabled={generating}
            >
              <span className="lbl">
                {v.label}
                {hasSaved && <span className="krowe-build-saved-dot" aria-label="Saved prompt available" />}
              </span>
              <span className="hint">{v.hint}</span>
            </button>
          );
        })}
      </div>

      {initState.kind === "init-loading" && (
        <div className="krowe-build-loading">
          <Sparkles className="h-4 w-4 krowe-build-spin" />
          <span>Loading saved prompts…</span>
        </div>
      )}

      {initState.kind === "ready" && generating && (
        <div className="krowe-build-loading">
          <Sparkles className="h-4 w-4 krowe-build-spin" />
          <span>Investigating repo and writing prompt for {labelFor(variant)}…</span>
        </div>
      )}

      {initState.kind === "ready" && !generating && error && (
        <div className="krowe-build-error">
          {error.needsRepo ? (
            <>
              <p>{error.message}</p>
              <Link href="/b/github/settings" className="krowe-btn-pill primary">
                Connect a repo
              </Link>
            </>
          ) : (
            <>
              <p>Couldn&apos;t generate prompt: {error.message}</p>
              <button
                type="button"
                className="krowe-btn-pill primary"
                onClick={() => generate(variant)}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Try again
              </button>
            </>
          )}
        </div>
      )}

      {initState.kind === "ready" && !generating && !error && !current && (
        <div className="krowe-build-cta">
          <button
            type="button"
            className="krowe-btn-pill primary"
            onClick={() => generate(variant)}
          >
            <Wand2 className="h-3.5 w-3.5" />
            Generate for {labelFor(variant)}
          </button>
          <span className="krowe-build-cta-hint">
            Takes ~15–25s — the AI inspects your repo to ground the prompt in real files. The result
            is saved so this is a one-time cost per agent.
          </span>
        </div>
      )}

      {initState.kind === "ready" && !generating && !error && current && (
        <>
          <div className="krowe-build-meta">
            <span className="krowe-build-repo">
              <FileCode className="h-3 w-3" />
              {current.repoFullName}
            </span>
            <span className="krowe-build-stamp" title={new Date(current.generatedAt).toLocaleString()}>
              Generated {formatRelTime(current.generatedAt)}
            </span>
            {current.result.notes && (
              <span className="krowe-build-notes">{current.result.notes}</span>
            )}
          </div>

          <div className="krowe-build-prompt-wrap">
            <button
              type="button"
              className="krowe-build-copy"
              onClick={handleCopy}
              aria-label="Copy prompt"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </>
              )}
            </button>
            <pre className="krowe-build-prompt">{current.result.prompt}</pre>
          </div>

          {current.result.filesReferenced.length > 0 && (
            <div className="krowe-build-files">
              <span className="krowe-build-files-label">Files inspected:</span>
              <div className="krowe-build-files-list">
                {current.result.filesReferenced.map((f) => (
                  <code key={f} className="krowe-build-file-chip">
                    {f}
                  </code>
                ))}
              </div>
            </div>
          )}

          <div className="krowe-build-actions">
            <button
              type="button"
              className="krowe-btn-pill primary"
              onClick={() => generate(variant)}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Regenerate
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function labelFor(variant: AgentVariant): string {
  return VARIANTS.find((v) => v.value === variant)?.label ?? variant;
}

function formatRelTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
