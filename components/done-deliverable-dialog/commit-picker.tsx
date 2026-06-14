"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GitCommit, Search, X } from "lucide-react";

export type PickedCommit = {
  sha: string;
  short_sha: string;
  message: string;
  html_url: string;
  author_name: string | null;
  author_login: string | null;
  committed_at: string | null;
  repo_full_name: string;
};

type ApiResponse =
  | { repo: string; commits: PickedCommit[] }
  | { error: string; message?: string };

interface Props {
  taskId: string;
  selected: PickedCommit[];
  onChange: (next: PickedCommit[]) => void;
  disabled?: boolean;
}

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; repo: string; commits: PickedCommit[] }
  | { kind: "no_repo" }
  | { kind: "auth" }
  | { kind: "error"; message: string };

function relTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso).getTime();
  const diffMin = Math.floor((Date.now() - d) / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `${h}h ago`;
  const dys = Math.floor(h / 24);
  if (dys < 7) return `${dys}d ago`;
  return new Date(iso).toLocaleDateString();
}

function firstLine(message: string): string {
  const line = (message ?? "").split("\n")[0];
  return line.length > 90 ? `${line.slice(0, 87)}…` : line;
}

export function CommitPicker({ taskId, selected, onChange, disabled }: Props) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    const url = `/api/github/engagement-commits?taskId=${encodeURIComponent(taskId)}${
      debounced ? `&q=${encodeURIComponent(debounced)}` : ""
    }`;
    fetch(url)
      .then(async (r) => {
        const body = (await r.json()) as ApiResponse;
        if (cancelled) return;
        if (r.status === 412 && "error" in body && body.error === "no_repo") {
          setState({ kind: "no_repo" });
          return;
        }
        if (r.status === 401) {
          setState({ kind: "auth" });
          return;
        }
        if (!r.ok || "error" in body) {
          const message = ("message" in body && body.message) || ("error" in body && body.error) || "Failed";
          setState({ kind: "error", message: String(message) });
          return;
        }
        setState({ kind: "ready", repo: body.repo, commits: body.commits });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : "Network error",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, debounced]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectedShas = useMemo(() => new Set(selected.map((c) => c.sha)), [selected]);

  const available =
    state.kind === "ready"
      ? state.commits.filter((c) => !selectedShas.has(c.sha))
      : [];

  function addCommit(c: PickedCommit) {
    if (selectedShas.has(c.sha)) return;
    onChange([...selected, c]);
    setQuery("");
    setOpen(false);
  }

  function removeCommit(sha: string) {
    onChange(selected.filter((c) => c.sha !== sha));
  }

  return (
    <div className="space-y-2" ref={containerRef}>
      {selected.length > 0 && (
        <ul className="space-y-1.5">
          {selected.map((c) => (
            <li
              key={c.sha}
              className="flex items-center justify-between gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-xs"
            >
              <div className="flex items-center gap-2 min-w-0">
                <GitCommit className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                <span className="font-mono text-neutral-700">{c.short_sha}</span>
                <span className="truncate text-neutral-600">{firstLine(c.message)}</span>
              </div>
              <button
                type="button"
                onClick={() => removeCommit(c.sha)}
                disabled={disabled}
                className="rounded p-0.5 text-neutral-400 hover:text-red-500 transition-colors disabled:opacity-50"
                aria-label={`Unlink commit ${c.short_sha}`}
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="relative">
        <div className="flex items-center gap-2 rounded-md border border-neutral-200 px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-neutral-900 focus-within:ring-offset-1">
          <Search className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder={
              state.kind === "ready"
                ? `Search commits in ${state.repo}`
                : "Search commits"
            }
            disabled={disabled || state.kind === "no_repo" || state.kind === "auth"}
            className="krowe-search-input flex-1 bg-transparent text-sm text-neutral-700 placeholder:text-neutral-400 focus:outline-none disabled:opacity-50"
          />
        </div>

        {open && (state.kind === "ready" || state.kind === "loading") && (
          <div className="absolute left-0 right-0 z-50 mt-1 max-h-64 overflow-y-auto rounded-md border border-neutral-200 bg-white shadow-lg">
            {state.kind === "loading" && (
              <div className="px-3 py-2 text-xs text-neutral-400">Loading commits…</div>
            )}
            {state.kind === "ready" && available.length === 0 && (
              <div className="px-3 py-2 text-xs text-neutral-400">
                {state.commits.length === 0
                  ? "No commits found."
                  : "All matching commits are already linked."}
              </div>
            )}
            {state.kind === "ready" &&
              available.map((c) => (
                <button
                  key={c.sha}
                  type="button"
                  onClick={() => addCommit(c)}
                  className="block w-full px-3 py-2 text-left transition-colors hover:bg-neutral-50"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-xs text-neutral-500">{c.short_sha}</span>
                    <span className="truncate text-sm text-neutral-800">{firstLine(c.message)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-neutral-400">
                    {c.author_name && <span>{c.author_name}</span>}
                    {c.committed_at && <span>· {relTime(c.committed_at)}</span>}
                  </div>
                </button>
              ))}
          </div>
        )}
      </div>

      {state.kind === "no_repo" && (
        <p className="text-xs text-neutral-500">
          No GitHub repo connected for this engagement.{" "}
          <a href="/b/github/settings" className="underline hover:text-neutral-700">
            Set one up
          </a>
          .
        </p>
      )}
      {state.kind === "auth" && (
        <p className="text-xs text-neutral-500">
          GitHub session expired.{" "}
          <a href="/b/github/settings" className="underline hover:text-neutral-700">
            Reconnect GitHub
          </a>
          .
        </p>
      )}
      {state.kind === "error" && (
        <p className="text-xs text-neutral-500">Couldn&apos;t load commits: {state.message}</p>
      )}
    </div>
  );
}
