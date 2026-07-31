"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useRouter, usePathname } from "next/navigation";
import {
  Search,
  FolderKanban,
  Briefcase,
  ListChecks,
  FileText,
  Receipt,
  FileSignature,
  ScrollText,
  ArrowRight,
  Maximize2,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { getCommandIndex, type CommandItem, type CommandItemType } from "@/lib/actions/search";
import { AgentConsole, capabilitiesFor, draftPrdHref } from "@/components/agent/agent-console";
import { useAgentRunsApiOptional } from "@/components/agent/agent-runs-provider";
import { createAgentRun } from "@/lib/actions/agent";
import { Ember } from "@/components/design-atoms";
import { hubKey, loadHub, peekHub, prefetchHub } from "@/lib/agent/hub-cache";
import {
  BUILDER_NAV,
  ENGAGEMENT_PATH,
  OPERATOR_NAV,
  PROJECT_PATH,
  resolveBuilderSection,
  resolveViewedDoc,
  sectionLabel,
} from "@/lib/nav-commands";
import { krowecanFor } from "@/lib/agent/section-prompts";
import { sectionForViewedDoc } from "@/lib/prd/viewed-section";
import { useTypewriter } from "@/lib/use-typewriter";

type PaletteMode = "search" | "agent";

type EntryType = CommandItemType | "nav";

interface Entry {
  id: string;
  type: EntryType;
  title: string;
  subtitle?: string;
  href: string;
  keywords: string; // lowercased
  titleLower: string;
}

const GROUP_ORDER: { key: string; label: string; types: CommandItemType[] }[] = [
  { key: "projects", label: "Projects", types: ["project"] },
  { key: "engagements", label: "Clients", types: ["engagement"] },
  { key: "tasks", label: "Tasks", types: ["task"] },
  { key: "documents", label: "Documents", types: ["prd", "quote", "contract"] },
  { key: "transcripts", label: "Transcripts", types: ["transcript"] },
];

const ICONS: Record<EntryType, LucideIcon> = {
  project: FolderKanban,
  engagement: Briefcase,
  task: ListChecks,
  prd: FileText,
  quote: Receipt,
  contract: FileSignature,
  transcript: ScrollText,
  nav: ArrowRight,
};

function isSubsequence(query: string, text: string): boolean {
  let qi = 0;
  for (let i = 0; i < text.length && qi < query.length; i++) {
    if (text[i] === query[qi]) qi++;
  }
  return qi === query.length;
}

/**
 * Rank an entry against a lowercased query. Title matches outrank deep-content
 * matches; subsequence (typo tolerance) is limited to the title so the large
 * keyword blob can't make everything match. Returns -1 for no match.
 */
function rank(query: string, titleLower: string, keywords: string): number {
  const ti = titleLower.indexOf(query);
  if (ti === 0) return 4; // title prefix
  if (ti > 0) return 3; // title substring
  if (keywords.indexOf(query) >= 0) return 2; // matches anywhere, incl. content
  if (isSubsequence(query, titleLower)) return 1; // fuzzy title
  return -1;
}

/**
 * Types each "Krowe can…" phrase, holds, deletes, then advances to the next — a
 * typewriter in place of the static "Ask Krowe or search…" label. The phrases
 * lean toward the page in view (see krowecanFor); `phrases` must be referentially
 * stable (the caller memoizes it) or the loop restarts. Falls back to a stable
 * label (no typing, no caret) under prefers-reduced-motion.
 */
function RotatingPlaceholder({ phrases }: { phrases: string[] }) {
  const { text, reduced } = useTypewriter(phrases);

  if (reduced) {
    return <span className="krowe-tb-search-ph">Ask Krowe or search…</span>;
  }

  return (
    <span className="krowe-tb-search-ph" aria-hidden="true">
      {text}
      <span className="krowe-tb-caret">▍</span>
    </span>
  );
}

interface GlobalSearchProps {
  role: "builder" | "operator";
}

export function GlobalSearch({ role }: GlobalSearchProps) {
  const router = useRouter();
  const pathname = usePathname();
  const isBuilder = role === "builder";
  // The side dock's run store — present for builders (their toolbar renders inside
  // AgentRunsProvider), null for operators. Lets a typed task start a run straight
  // into the dock instead of opening the full agent popup.
  const runsApi = useAgentRunsApiOptional();
  const [open, setOpen] = React.useState(false);
  // The minimal view (builder-only, Agent Hub direction E): an attached search
  // dropdown that grows out of the toolbar bar without dimming the page. Search
  // is the lead action; the full-screen palette (`open`) is one Expand behind it
  // and the agent hub (`open` + mode "agent") one Ask behind it.
  const [dropdownOpen, setDropdownOpen] = React.useState(false);
  // Builders open on the agent hub — asking is the lead action, and the search
  // list sits one Escape behind it. Operators have no agent, so they only ever
  // see search.
  const [mode, setMode] = React.useState<PaletteMode>(isBuilder ? "agent" : "search");
  const [query, setQuery] = React.useState("");
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [index, setIndex] = React.useState<CommandItem[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(false);
  // Seed for the agent view: the omnibox text the builder chose to "ask". The
  // nonce bumps on every ask so the AgentConsole remounts into a fresh thread.
  const [seedQuery, setSeedQuery] = React.useState("");
  // A capability id handed to the agent hub when the builder picks one from the
  // dropdown's "Krowe can" list; cleared on any other way of opening the hub.
  const [seedCapability, setSeedCapability] = React.useState<string | null>(null);
  const [seedNonce, setSeedNonce] = React.useState(0);

  // Session cache: the index loads once on first open and stays put while the
  // component is mounted (resets on a full page reload).
  const cacheRef = React.useRef<CommandItem[] | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const dropdownInputRef = React.useRef<HTMLInputElement>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  const loadIndex = React.useCallback(async () => {
    if (cacheRef.current) {
      setIndex(cacheRef.current);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      const data = await getCommandIndex();
      cacheRef.current = data;
      setIndex(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Global ⌘K / Ctrl+K: for builders this toggles the attached search dropdown
  // (the minimal view); for operators it toggles the full search palette. ⌘J /
  // Ctrl+J jumps builders straight to the full agent hub, skipping search.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (isBuilder) setDropdownOpen((o) => !o);
        else setOpen((o) => !o);
      } else if (isBuilder && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setSeedQuery("");
        setSeedCapability(null);
        setSeedNonce((n) => n + 1);
        setMode("agent");
        setDropdownOpen(false);
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isBuilder]);

  // Load on open; reset query/selection on close.
  React.useEffect(() => {
    if (open) {
      loadIndex();
    } else {
      setQuery("");
      setSelectedIndex(0);
      setMode(isBuilder ? "agent" : "search"); // every open starts at the default
    }
  }, [open, loadIndex, isBuilder]);

  // The attached dropdown: warm the index, start every open on a clean query, and
  // focus its search field. Closing deliberately leaves the query alone — Expand
  // and Ask close the dropdown *and* open the full palette, which carries the
  // query over; the next fresh open resets it here.
  React.useEffect(() => {
    if (!dropdownOpen) return;
    loadIndex();
    setQuery("");
    setSelectedIndex(0);
    const t = setTimeout(() => dropdownInputRef.current?.focus(), 20);
    return () => clearTimeout(t);
  }, [dropdownOpen, loadIndex]);

  // Dismiss the dropdown on an outside click or Escape, the way any attached
  // popover behaves. Escape lives on the window (not the panel) so it fires even
  // when focus has drifted off the input.
  React.useEffect(() => {
    if (!dropdownOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [dropdownOpen]);

  // Reset highlight whenever the query changes.
  React.useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const navCommands = role === "operator" ? OPERATOR_NAV : BUILDER_NAV;

  // Name the client in the interpret banner, but only when we can do it for
  // free and be right: on a client page the path pins the scope, and the index
  // (already loaded) carries the title. Anywhere else the agent resolves scope
  // itself, so the banner stays deliberately unspecific rather than guessing a
  // client the console might not pick.
  const pathEngagementId = pathname?.match(ENGAGEMENT_PATH)?.[1] ?? null;
  // On a document/project page, pin the viewed project so the agent's document
  // tools scope to it (and can reach an orphan-project draft PRD).
  const pathProjectId = pathname?.match(PROJECT_PATH)?.[1] ?? null;
  // On a specific document page, also pin WHICH document — so a "change the
  // document" request with no title assumes the one the builder is looking at.
  const viewedDoc = React.useMemo(() => resolveViewedDoc(pathname), [pathname]);

  // Warm the agent hub before it's asked for. Builders open the palette *on* the
  // hub, whose Context row costs a server round trip — so fetch it here, on the
  // always-mounted toolbar, and that cost lands before ⌘K instead of in front of
  // it. Short delay to stay behind the page's own data; a no-op once the scope
  // is cached, so navigating around doesn't re-fetch a client we already hold.
  React.useEffect(() => {
    if (!isBuilder) return;
    const t = setTimeout(() => prefetchHub(hubKey(pathEngagementId)), 300);
    return () => clearTimeout(t);
  }, [isBuilder, pathEngagementId]);

  const scopedClient = React.useMemo(() => {
    if (!pathEngagementId || !index) return null;
    return index.find((it) => it.type === "engagement" && it.id === pathEngagementId)?.title ?? null;
  }, [index, pathEngagementId]);

  // Page-aware surface: lean the rotating placeholder and the "Krowe can" list
  // toward the page the toolbar is sitting over. `placeholderClient` reads well
  // even off a client page, where the omnibox has no scoped client to name.
  const section = resolveBuilderSection(pathname);
  const placeholderClient = scopedClient ?? "a client";
  const placeholderPhrases = React.useMemo(
    () => krowecanFor(section, placeholderClient),
    [section, placeholderClient]
  );

  const entries = React.useMemo<Entry[]>(() => {
    const navEntries: Entry[] = navCommands.map((n) => ({
      id: n.id,
      type: "nav",
      title: n.title,
      subtitle: "Go to",
      href: n.href,
      keywords: n.keywords,
      titleLower: n.title.toLowerCase(),
    }));
    const dataEntries: Entry[] = (index ?? []).map((it) => ({
      ...it,
      titleLower: it.title.toLowerCase(),
    }));
    return [...navEntries, ...dataEntries];
  }, [navCommands, index]);

  const { groups, flatItems } = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const navE = entries.filter((e) => e.type === "nav");
    const dataE = entries.filter((e) => e.type !== "nav");

    const apply = (arr: Entry[]) =>
      arr
        .map((e) => ({ e, s: rank(q, e.titleLower, e.keywords) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.e);

    // Empty query → lead with the agent (rendered above the list) and just the
    // top 3 "Go to…" destinations, so the default palette is agent-first rather
    // than a wall of nav links. A typed query searches every destination.
    const data = q ? apply(dataE) : [];
    const nav = q ? apply(navE) : navE.slice(0, 3);

    const grps: { key: string; label: string; items: Entry[] }[] = [];
    for (const g of GROUP_ORDER) {
      const its = data.filter((e) => g.types.includes(e.type as CommandItemType));
      if (its.length) grps.push({ key: g.key, label: g.label, items: its });
    }
    if (nav.length) grps.push({ key: "nav", label: "Go to…", items: nav });

    return { groups: grps, flatItems: grps.flatMap((g) => g.items) };
  }, [entries, query]);

  // Keep the highlighted row in view as it moves (either surface).
  React.useEffect(() => {
    if (!open && !dropdownOpen) return;
    const el = document.getElementById(`krowe-cmd-item-${selectedIndex}`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, open, dropdownOpen, query]);

  // Return focus to the search input when leaving the agent view (onOpenAutoFocus
  // only covers the initial open, not the agent → search transition).
  React.useEffect(() => {
    if (open && mode === "search") inputRef.current?.focus();
  }, [open, mode]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  // Hand the omnibox text to the agent: seed a fresh thread and open the full
  // palette on the agent view (the conversation only lives there). An empty text
  // opens the hub fresh. Builder-only (operators have no agent).
  function askAgent(text: string) {
    setSeedQuery(text);
    setSeedCapability(null);
    setSeedNonce((n) => n + 1);
    setMode("agent");
    setDropdownOpen(false);
    setOpen(true);
  }

  // Send a typed task straight to the side dock instead of opening the full agent
  // popup. Replicates AgentThread.send()'s fresh-run path: resolve the client from
  // the (usually already warm) hub cache, create the run, then hand it to the runs
  // provider — which paints a progress ring beside the search bar and streams it to
  // completion, palette never opened. Falls back to opening the hub when there's no
  // task, no runs provider (operator), or no client in scope to run against.
  async function queueAgentTask(text: string) {
    const content = text.trim();
    if (!content || !isBuilder || !runsApi) {
      askAgent(text);
      return;
    }
    setDropdownOpen(false);
    try {
      const key = hubKey(pathEngagementId);
      const hub = peekHub(key) ?? (await loadHub(key));
      const engagementId = hub.engagementId;
      if (!engagementId) {
        // No client resolved — open the hub so the builder can pick one.
        askAgent(text);
        return;
      }
      const clientName =
        hub.engagements.find((e) => e.id === engagementId)?.title || "this client";
      const res = await createAgentRun(engagementId, content);
      if ("error" in res) {
        toast.error("Couldn't queue that task", { description: res.error });
        return;
      }
      runsApi.startRun({
        runId: res.run.id,
        engagementId,
        projectId: pathProjectId,
        viewedDoc,
        viewedSection: sectionForViewedDoc(viewedDoc),
        clientName,
        title: content.split("\n")[0].slice(0, 60),
        message: content,
        page: sectionLabel(section) ?? undefined,
      });
    } catch {
      toast.error("Couldn't queue that task", { description: "Try again." });
    }
  }

  // Open the agent hub on a chosen capability (from the dropdown's "Krowe can"
  // list). The hub resolves the client, then fires it — asking outright or
  // drafting the sentence's opening into its hero input.
  function askCapability(id: string) {
    setSeedQuery("");
    setSeedCapability(id);
    setSeedNonce((n) => n + 1);
    setMode("agent");
    setDropdownOpen(false);
    setOpen(true);
  }

  // A "navigate" capability (Draft a PRD) leaves the palette for a route instead of
  // seeding a thread. Resolve the in-scope client's project from the warm hub cache
  // so it lands straight in that project's New PRD wizard (else the projects list).
  async function navigateCapability(id: string) {
    if (id !== "draft-prd") return;
    setDropdownOpen(false);
    setOpen(false);
    let projectId: string | null = null;
    try {
      const key = hubKey(pathEngagementId);
      const hub = peekHub(key) ?? (await loadHub(key));
      projectId = hub.engagements.find((e) => e.id === hub.engagementId)?.projectId ?? null;
    } catch {
      // no warm hub — fall back to the projects list
    }
    router.push(draftPrdHref(projectId));
  }

  // Expand the attached dropdown into the full-screen Agent Hub — the big
  // version of the same panel (hero input, Context row, the "Krowe can" grid,
  // suggestions, recents). Opens the hub idle rather than seeding a thread; ⌘↵
  // stays the way a typed query is handed to the agent.
  function expandToHub() {
    setSeedQuery("");
    setSeedCapability(null);
    setSeedNonce((n) => n + 1);
    setMode("agent");
    setDropdownOpen(false);
    setOpen(true);
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (isBuilder && (e.metaKey || e.ctrlKey) && e.key === "Enter") {
      // ⌘↵ / Ctrl+↵ → queue the task straight to the side dock (empty → open the
      // hub fresh).
      e.preventDefault();
      void queueAgentTask(q);
    } else if (isBuilder && (e.metaKey || e.ctrlKey) && e.key === "ArrowUp") {
      // ⌘↑ → expand the attached dropdown into the full-screen Agent Hub.
      e.preventDefault();
      expandToHub();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, Math.max(flatItems.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = flatItems[selectedIndex];
      if (it) go(it.href);
    }
  }

  const q = query.trim();

  // Shared results renderer for the attached dropdown and the full palette: one
  // flat index spans all groups so arrow-key selection and the ids the scroll
  // effect targets stay in step. Only one surface mounts at a time (the dropdown
  // when `dropdownOpen`, the palette when `open`), so the row ids never collide.
  function renderResults() {
    let flat = -1;
    return groups.map((g) => (
      <div key={g.key} className="krowe-cmd-group" role="group" aria-label={g.label}>
        <div className="krowe-cmd-group-label">{g.label}</div>
        {g.items.map((e) => {
          flat += 1;
          const idx = flat;
          const Icon = ICONS[e.type] ?? ArrowRight;
          const selected = idx === selectedIndex;
          return (
            <div
              key={`${e.type}-${e.id}`}
              id={`krowe-cmd-item-${idx}`}
              role="option"
              aria-selected={selected}
              data-selected={selected}
              className="krowe-cmd-item"
              onMouseEnter={() => setSelectedIndex(idx)}
              onClick={() => go(e.href)}
            >
              <Icon size={16} className="krowe-cmd-item-ic" />
              <span className="krowe-cmd-item-title">{e.title}</span>
              {e.subtitle && <span className="krowe-cmd-item-sub">{e.subtitle}</span>}
            </div>
          );
        })}
      </div>
    ));
  }

  // The always-present "Ask Krowe" row (builder-only) — the agent escape hatch
  // under the matches, in both the dropdown and the full palette. Not part of
  // flatItems, so it never steals arrow-key focus or plain Enter; ⌘↵ or a click
  // fires it. Empty query → opens the hub; typed → seeds the agent with it.
  const askLabel = q ? (
    <>
      Ask Krowe about <span className="krowe-cmd-ask-q">“{q}”</span>
    </>
  ) : scopedClient ? (
    <>Ask Krowe about {scopedClient}</>
  ) : (
    <>Ask Krowe about your workspace</>
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      {/* The bar anchors the attached dropdown (which grows out of it) via a
          relative wrapper. For builders the bar toggles that dropdown; for
          operators it triggers the full search palette as before. */}
      <div className="krowe-tb-searchwrap" ref={wrapRef}>
        {isBuilder ? (
          <button
            type="button"
            className="krowe-tb-search"
            aria-label="Search or ask Krowe (⌘K)"
            aria-haspopup="dialog"
            aria-expanded={dropdownOpen}
            onClick={() => setDropdownOpen((o) => !o)}
          >
            <Ember size={15} />
            <RotatingPlaceholder phrases={placeholderPhrases} />
            <span className="krowe-kbd">⌘K</span>
          </button>
        ) : (
          <DialogPrimitive.Trigger asChild>
            <button type="button" className="krowe-tb-search" aria-label="Search (⌘K)">
              <Search size={15} strokeWidth={2} style={{ color: "var(--faint-foreground)" }} />
              <span className="krowe-tb-search-ph">Search anything…</span>
              <span className="krowe-kbd">⌘K</span>
            </button>
          </DialogPrimitive.Trigger>
        )}

        {isBuilder && dropdownOpen && (
          <div className="krowe-ah-attached" role="dialog" aria-label="Search or ask Krowe">
            <div className="krowe-ah-att-search">
              <span className="krowe-ah-att-glyph">
                <Search size={15} strokeWidth={2} />
              </span>
              <input
                ref={dropdownInputRef}
                className="krowe-ah-att-input"
                placeholder="Search anything, or ask Krowe…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKeyDown}
                role="combobox"
                aria-expanded
                aria-controls="krowe-ah-att-list"
                aria-activedescendant={
                  flatItems.length ? `krowe-cmd-item-${selectedIndex}` : undefined
                }
                autoComplete="off"
                spellCheck={false}
              />
              <span className="krowe-ah-att-tools">
                <button
                  type="button"
                  className="krowe-pk-btn"
                  onClick={expandToHub}
                  aria-label="Open full-screen agent hub (⌘↑)"
                  title="Open full screen"
                >
                  <Maximize2 size={15} />
                </button>
                <button
                  type="button"
                  className="krowe-pk-btn"
                  onClick={() => setDropdownOpen(false)}
                  aria-label="Close"
                  title="Close"
                >
                  <X size={16} />
                </button>
              </span>
            </div>

            <div className="krowe-ah-att-body" id="krowe-ah-att-list" role="listbox">
              {loading && index === null && q && (
                <div className="krowe-cmd-loading">Searching…</div>
              )}
              {error && (
                <div className="krowe-cmd-empty">Couldn&apos;t load search. Try again.</div>
              )}

              {/* Empty query leads with what the agent can do — one row per
                  capability (see CAPABILITIES). Picking one opens the hub already
                  carrying that intent. A typed query switches to search results. */}
              {q ? (
                renderResults()
              ) : (
                <div className="krowe-cmd-group" role="group" aria-label="Krowe can">
                  <div className="krowe-cmd-group-label">Krowe can</div>
                  {capabilitiesFor(section).map((c) => {
                    const Icon = c.icon;
                    return (
                      <div
                        key={c.id}
                        role="option"
                        aria-selected={false}
                        className="krowe-cmd-item"
                        onClick={() => (c.mode === "navigate" ? void navigateCapability(c.id) : askCapability(c.id))}
                      >
                        <Icon size={16} className="krowe-cmd-item-ic" />
                        <span className="krowe-cmd-item-title">{c.title}</span>
                        <span className="krowe-cmd-item-sub">{c.detail}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              <div
                className="krowe-cmd-item krowe-ah-att-ask"
                role="option"
                aria-selected={false}
                onClick={() => void queueAgentTask(q)}
              >
                <span className="krowe-ah-att-ember">
                  <Ember size={16} />
                </span>
                <span className="krowe-cmd-item-title">{askLabel}</span>
                <span className="krowe-kbd">⌘↵</span>
              </div>
            </div>

            <div className="krowe-cmd-foot">
              <span>
                <span className="k">↑↓</span> navigate
              </span>
              <span>
                <span className="k">↵</span> open
              </span>
              <span>
                <span className="k">⌘↵</span> queue
              </span>
              <span>
                <span className="k">⌘↑</span> full
              </span>
            </div>
          </div>
        )}
      </div>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="krowe-cmd-overlay" />
        <DialogPrimitive.Content
          className="krowe-cmd"
          aria-label="Search and navigate"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
          onEscapeKeyDown={(e) => {
            // In the agent view, Escape returns to the search omnibox (query
            // preserved) rather than closing the whole palette.
            if (mode === "agent") {
              e.preventDefault();
              setMode("search");
            }
          }}
        >
          <DialogPrimitive.Title className="sr-only">Search and navigate</DialogPrimitive.Title>

          {mode === "agent" ? (
            <AgentConsole
              key={seedNonce}
              initialQuery={seedQuery || undefined}
              initialCapability={seedCapability || undefined}
              onBack={() => setMode("search")}
              onClose={() => setOpen(false)}
            />
          ) : (
          <>
          <div className="krowe-cmd-inputwrap">
            <Search size={16} strokeWidth={2} />
            <input
              ref={inputRef}
              className="krowe-cmd-input"
              placeholder="Search projects, tasks, documents…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKeyDown}
              role="combobox"
              aria-expanded
              aria-controls="krowe-cmd-list"
              aria-activedescendant={
                flatItems.length ? `krowe-cmd-item-${selectedIndex}` : undefined
              }
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="krowe-cmd-list" id="krowe-cmd-list" role="listbox">
            {loading && index === null && (
              <div className="krowe-cmd-loading">Searching…</div>
            )}
            {error && (
              <div className="krowe-cmd-empty">Couldn&apos;t load search. Try again.</div>
            )}

            {/* Agent entry point — builders only, and the palette's lead action.
                Empty query → a promoted card that opens the console fresh (⌘J).
                Typed query → a compact pinned row that seeds the agent with it
                (⌘↵). Neither is part of flatItems, so they never steal arrow-key
                focus or plain Enter. */}
            {isBuilder && !q && (
              <button
                type="button"
                className="krowe-cmd-agent-card"
                onClick={() => setMode("agent")}
              >
                <span className="krowe-ah-ember">
                  <Ember size={17} />
                </span>
                <span className="krowe-cmd-agent-card-body">
                  <span className="krowe-cmd-agent-card-t">Ask the agent</span>
                  <span className="krowe-cmd-agent-card-s">
                    Reason over a client&apos;s context — documents, tasks, timeline, and code.
                  </span>
                </span>
                <span className="krowe-kbd">⌘J</span>
              </button>
            )}
            {isBuilder && q && (
              <button
                type="button"
                className="krowe-ah-interpret"
                onClick={() => askAgent(q)}
              >
                <span className="krowe-ah-ember">
                  <Ember size={17} />
                </span>
                <span className="krowe-ah-interpret-tx">
                  <span className="krowe-ah-interpret-t">
                    Ask Krowe about <span className="krowe-cmd-ask-q">“{q}”</span>
                  </span>
                  <span className="krowe-ah-interpret-d">
                    {scopedClient
                      ? `Reason over ${scopedClient} — tasks, docs, timeline & code`
                      : "Reason over a client's context — tasks, docs, timeline & code"}
                  </span>
                </span>
                <span className="krowe-kbd">⌘↵</span>
              </button>
            )}

            {renderResults()}

            {!loading && !error && groups.length === 0 && (
              <div className="krowe-cmd-empty">
                {q ? `No results for “${q}”` : "Type to search…"}
              </div>
            )}
          </div>

          <div className="krowe-cmd-foot">
            <span>
              <span className="k">↑↓</span> navigate
            </span>
            <span>
              <span className="k">↵</span> open
            </span>
            {isBuilder && (
              <span>
                <span className="k">⌘↵</span> ask
              </span>
            )}
            <span>
              <span className="k">esc</span> close
            </span>
          </div>
          </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
