"use client";

// ⚠️ TEMPORARY / THROWAWAY dev-only chat UI. Talks to /api/dev/context-query
// (POST). Colors use the app's CSS variables so it themes correctly; layout is
// plain Tailwind. Delete with the route + page when the real agent flow lands.

import { useEffect, useRef, useState } from "react";

type Source = { title: string; kind: string; similarity: number; chunkIndex: number };
type Msg = {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  meta?: string;
  debug?: string;
};

const card: React.CSSProperties = {
  background: "color-mix(in oklch, var(--foreground) 4%, var(--background))",
  border: "1px solid var(--border)",
};

// Dark theme scoped to JUST this chat. Overrides the app's warm-neutral tokens
// (hue 60, never cold gray) on the root container; every child reads var(--…),
// so the whole chat goes dark while the rest of the app stays light.
const darkTheme = {
  colorScheme: "dark",
  "--background": "oklch(17% 0.012 60)",
  "--surface-subtle": "oklch(20% 0.012 60)",
  "--surface-sunken": "oklch(23% 0.012 60)",
  "--foreground": "oklch(95% 0.006 60)",
  "--muted-foreground": "oklch(68% 0.012 60)",
  "--faint-foreground": "oklch(55% 0.01 60)",
  "--border": "oklch(32% 0.01 60)",
  "--border-strong": "oklch(40% 0.012 60)",
} as React.CSSProperties;

export default function ContextChat({ defaultEngagementId }: { defaultEngagementId: string }) {
  const [engagementId, setEngagementId] = useState(defaultEngagementId);
  const [devMatch, setDevMatch] = useState(true);
  const [k, setK] = useState<string>("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading || !engagementId.trim()) return;
    setError(null);
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/dev/context-query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          engagementId: engagementId.trim(),
          devmatch: devMatch,
          ...(k.trim() && Number.isFinite(Number(k)) ? { k: Number(k) } : {}),
          messages: next.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || `Request failed (${res.status})`);
        return;
      }
      setMessages([
        ...next,
        {
          role: "assistant",
          content: data.answer,
          sources: data.sources,
          meta: `${data.model} · effort=${data.effort} · ${data.retrievalMode} · ${data.retrievedCount} snippet(s)`,
          debug: data.debugText,
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div
      className="flex h-dvh flex-col"
      style={{ ...darkTheme, background: "var(--background)", color: "var(--foreground)" }}
    >
      {/* Header */}
      <header className="shrink-0 border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Context Chat</span>
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
              style={{ background: "color-mix(in oklch, var(--foreground) 8%, transparent)", color: "var(--muted-foreground)" }}
            >
              dev · temp
            </span>
            <button
              onClick={() => { setMessages([]); setError(null); }}
              className="ml-auto rounded-md px-2 py-1 text-xs"
              style={{ border: "1px solid var(--border)", color: "var(--muted-foreground)" }}
            >
              Clear
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs" style={{ color: "var(--muted-foreground)" }}>
            <label className="flex items-center gap-1.5">
              engagement
              <input
                value={engagementId}
                onChange={(e) => setEngagementId(e.target.value)}
                spellCheck={false}
                className="w-[330px] rounded-md px-2 py-1 font-mono text-[11px] outline-none"
                style={{ ...card, color: "var(--foreground)" }}
              />
            </label>
            <label className="flex items-center gap-1.5">
              top-k
              <input
                value={k}
                onChange={(e) => setK(e.target.value)}
                placeholder="auto"
                inputMode="numeric"
                className="w-16 rounded-md px-2 py-1 text-[11px] outline-none"
                style={{ ...card, color: "var(--foreground)" }}
              />
            </label>
            <label className="flex cursor-pointer select-none items-center gap-1.5">
              <input type="checkbox" checked={devMatch} onChange={(e) => setDevMatch(e.target.checked)} />
              devmatch (bypass auth.uid guard)
            </label>
          </div>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {messages.length === 0 && (
            <p className="mt-10 text-center text-sm" style={{ color: "var(--muted-foreground)" }}>
              Ask anything about this client&apos;s context — e.g.{" "}
              <em>&ldquo;What are the staff access rules?&rdquo;</em>
            </p>
          )}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div
                  className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm px-3.5 py-2 text-sm"
                  style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
                >
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={i} className="flex flex-col gap-1.5">
                <div
                  className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-sm leading-relaxed"
                  style={card}
                >
                  {m.content}
                </div>
                {m.sources && m.sources.length > 0 && (
                  <details className="max-w-[88%] text-xs" style={{ color: "var(--muted-foreground)" }}>
                    <summary className="cursor-pointer select-none">
                      {m.meta} · {m.sources.length} source{m.sources.length === 1 ? "" : "s"}
                    </summary>
                    <ul className="mt-1.5 flex flex-col gap-0.5 pl-1">
                      {m.sources.map((s, j) => (
                        <li key={j} className="font-mono text-[11px]">
                          {String(j + 1).padStart(2, " ")}. {s.title} [{s.kind}] · sim {s.similarity} · chunk {s.chunkIndex}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {m.debug && (
                  <details className="max-w-[88%] text-xs" style={{ color: "var(--muted-foreground)" }}>
                    <summary className="cursor-pointer select-none">
                      full test output (terminal block + serialized context fed to the model)
                    </summary>
                    <pre
                      className="mt-1.5 max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-md p-3 font-mono text-[11px] leading-relaxed"
                      style={card}
                    >
                      {m.debug}
                    </pre>
                  </details>
                )}
              </div>
            )
          )}

          {loading && (
            <div className="flex items-center gap-2 text-sm" style={{ color: "var(--muted-foreground)" }}>
              <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: "var(--muted-foreground)" }} />
              retrieving + thinking…
            </div>
          )}
          {error && (
            <div className="rounded-md px-3 py-2 text-sm" style={{ border: "1px solid var(--border)", color: "#ef4444" }}>
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t px-4 py-3" style={{ borderColor: "var(--border)" }}>
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Message the context…  (Enter to send, Shift+Enter for newline)"
            className="max-h-40 flex-1 resize-none rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ ...card, color: "var(--foreground)" }}
          />
          <button
            onClick={() => void send()}
            disabled={loading || !input.trim()}
            className="rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-40"
            style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
