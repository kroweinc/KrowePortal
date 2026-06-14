"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
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
  type LucideIcon,
} from "lucide-react";
import { getCommandIndex, type CommandItem, type CommandItemType } from "@/lib/actions/search";

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

interface NavCommand {
  id: string;
  title: string;
  href: string;
  keywords: string;
}

// Static "Go to" destinations — client-side, never hit the DB, always available
// (even before the index loads or for a brand-new empty account).
const BUILDER_NAV: NavCommand[] = [
  { id: "nav-b-tasks", title: "Tasks", href: "/b", keywords: "tasks build board home" },
  { id: "nav-b-engagements", title: "Clients", href: "/b/engagements", keywords: "clients" },
  { id: "nav-b-projects", title: "Documents", href: "/b/projects", keywords: "documents projects prospects" },
  { id: "nav-b-new", title: "New document", href: "/b/projects/new", keywords: "new document project create" },
  { id: "nav-b-repo", title: "Repo", href: "/b/github", keywords: "repo github code repositories" },
  { id: "nav-b-repo-settings", title: "Repo settings", href: "/b/github/settings", keywords: "github settings connect repo" },
  { id: "nav-b-profile", title: "Profile", href: "/b/profile", keywords: "profile resume portfolio" },
  { id: "nav-b-settings", title: "Settings", href: "/b/settings", keywords: "settings account display name" },
];

const OPERATOR_NAV: NavCommand[] = [
  { id: "nav-o-tasks", title: "Tasks", href: "/o", keywords: "tasks home" },
  { id: "nav-o-engagement", title: "Builder", href: "/o/engagement", keywords: "builder profile contact documents" },
  { id: "nav-o-project", title: "Project", href: "/o/project", keywords: "project repo overview milestones" },
];

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

interface GlobalSearchProps {
  role: "builder" | "operator";
}

export function GlobalSearch({ role }: GlobalSearchProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [index, setIndex] = React.useState<CommandItem[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(false);

  // Session cache: the index loads once on first open and stays put while the
  // component is mounted (resets on a full page reload).
  const cacheRef = React.useRef<CommandItem[] | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

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

  // Global ⌘K / Ctrl+K toggle.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Load on open; reset query/selection on close.
  React.useEffect(() => {
    if (open) {
      loadIndex();
    } else {
      setQuery("");
      setSelectedIndex(0);
    }
  }, [open, loadIndex]);

  // Reset highlight whenever the query changes.
  React.useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const navCommands = role === "operator" ? OPERATOR_NAV : BUILDER_NAV;

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

    // Empty query → only the "Go to…" destinations, so the palette is useful
    // immediately without dumping every record.
    const data = q ? apply(dataE) : [];
    const nav = q ? apply(navE) : navE;

    const grps: { key: string; label: string; items: Entry[] }[] = [];
    for (const g of GROUP_ORDER) {
      const its = data.filter((e) => g.types.includes(e.type as CommandItemType));
      if (its.length) grps.push({ key: g.key, label: g.label, items: its });
    }
    if (nav.length) grps.push({ key: "nav", label: "Go to…", items: nav });

    return { groups: grps, flatItems: grps.flatMap((g) => g.items) };
  }, [entries, query]);

  // Keep the highlighted row in view as it moves.
  React.useEffect(() => {
    if (!open) return;
    const el = document.getElementById(`krowe-cmd-item-${selectedIndex}`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, open, query]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
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
  let flat = -1;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <button type="button" className="krowe-tb-search" aria-label="Search (⌘K)">
          <Search size={15} strokeWidth={2} style={{ color: "var(--faint-foreground)" }} />
          <span className="krowe-tb-search-ph">Search anything…</span>
          <span className="krowe-kbd">⌘K</span>
        </button>
      </DialogPrimitive.Trigger>

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
        >
          <DialogPrimitive.Title className="sr-only">Search and navigate</DialogPrimitive.Title>

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

            {groups.map((g) => (
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
            ))}

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
            <span>
              <span className="k">esc</span> close
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
