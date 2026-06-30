"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  FileText,
  StickyNote,
  Link2,
  Plus,
  Search,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  ExternalLink,
  ArrowUpRight,
  Trash2,
} from "lucide-react";
import { useContextMenu, ContextMenu, type MenuItem } from "@/components/ui/context-menu";
import { SOP_ACCEPT, MAX_SOP_CHARS } from "@/lib/attachments-constants";
import {
  getContextItemSignedUrl,
  addContextNote,
  addContextLink,
  addContextDocument,
  deleteContextItem,
  syncEngagementDocuments,
} from "@/lib/actions/context";
import { searchClientContext, type ContextSearchHit } from "@/lib/actions/context-search";
import { safeExternalHref } from "@/lib/project/business-context";
import {
  CATS,
  CAT_ORDER,
  catOf,
  noteOf,
  isStandaloneContextItem,
  type CatKey,
} from "@/components/context/categories";
import type { ClientGraph, GraphNode } from "@/lib/actions/context-graph";
import type { ContextItem, ContextItemKind } from "@/lib/types";

const inputClass =
  "w-full rounded border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400";

function formatCount(n: number | null): string {
  if (!n) return "";
  if (n < 1000) return `${n} chars`;
  return `${Math.round(n / 1000)}k chars`;
}

function kindIcon(kind: ContextItemKind) {
  if (kind === "note") return <StickyNote size={17} strokeWidth={1.9} />;
  if (kind === "link") return <Link2 size={17} strokeWidth={1.9} />;
  return <FileText size={17} strokeWidth={1.9} />;
}

// Small RAG-readiness label. Links are intentionally not embedded in v1.
function statusChip(item: ContextItem): { label: string; tone: string } | null {
  switch (item.embedding_status) {
    case "pending":
      return { label: "Indexing…", tone: "chip-kind" };
    case "ready":
      return { label: `Indexed · ${item.chunk_count}`, tone: "chip-kind" };
    case "failed":
      return { label: "Index failed", tone: "chip-kind" };
    case "skipped":
      return item.kind === "link" ? { label: "Link", tone: "chip-kind" } : null;
    default:
      return null;
  }
}

export function ContextPanel({
  engagementId,
  items,
  setItems,
  graph,
  showIndexStatus = false,
}: {
  engagementId: string;
  // Owned by ContextView so the Graph and List share one source of truth — an
  // add/delete here updates the Overview graph in the same render.
  items: ContextItem[];
  setItems: React.Dispatch<React.SetStateAction<ContextItem[]>>;
  graph: ClientGraph;
  showIndexStatus?: boolean;
}) {
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ContextSearchHit[] | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isSearching, startSearch] = useTransition();
  const [isSyncingDocs, setIsSyncingDocs] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Everything else the graph shows (client, people, project, the project
  // documents, milestones, tasks…), bucketed by category. The "context"
  // bucket is rendered separately from the live `items` state so adds/deletes
  // and content previews stay interactive.
  const nodesByCat = useMemo(() => {
    const m = new Map<CatKey, GraphNode[]>();
    for (const n of graph.nodes) {
      const cat = catOf(n.group);
      if (cat === "context") continue;
      const arr = m.get(cat);
      if (arr) arr.push(n);
      else m.set(cat, [n]);
    }
    return m;
  }, [graph]);

  // The Context bucket lists *standalone* knowledge only. Auto-doc mirrors of a
  // PRD/quote/contract — profile mirrors of the builder/operator — and the
  // auto-entity mirrors of a task / milestone aren't shown here: they belong to
  // their own node (a document, a person, or that task / milestone), matching
  // the graph, where each mirror is folded into that node instead of drawn as a
  // separate one. Other auto-entity mirrors (briefs, change orders, etc.) have
  // no node of their own and stay listed here.
  const standaloneItems = useMemo(() => items.filter(isStandaloneContextItem), [items]);

  // On load, mirror the project's PRD/quote/contract into this client's context
  // if they aren't already (covers docs authored before auto-sync, or drafted
  // before the engagement was linked), then reconcile against the refreshed list.
  // res.items is AUTHORITATIVE — it's the full list after the server's backfill
  // and orphan reconcile (e.g. a brief whose source row was deleted is dropped).
  // We take it as the source of truth and only re-add locally-created manual
  // items the fetch may have raced (a note/link/upload added mid-sync, not yet
  // visible to the read). Crucially we DON'T re-add server-managed mirrors that
  // are absent — otherwise the merge would resurrect the orphan the server just
  // cleaned up, leaving a ghost node in the Overview graph.
  useEffect(() => {
    let cancelled = false;
    setIsSyncingDocs(true);
    syncEngagementDocuments(engagementId)
      .then((res) => {
        if (cancelled || !res.items) return;
        const serverItems = res.items;
        setItems((prev) => {
          const serverIds = new Set(serverItems.map((i) => i.id));
          const localExtras = prev.filter((i) => {
            if (serverIds.has(i.id)) return false;
            const src = (i.source_meta as { source?: string } | null)?.source;
            return src === "paste" || src === "link" || src === "upload";
          });
          return [...serverItems, ...localExtras].sort((a, b) =>
            b.created_at.localeCompare(a.created_at)
          );
        });
      })
      .finally(() => {
        if (!cancelled) setIsSyncingDocs(false);
      });
    return () => {
      cancelled = true;
    };
  }, [engagementId]);

  function resetNote() {
    setShowNoteForm(false);
    setNoteTitle("");
    setNoteBody("");
  }
  function resetLink() {
    setShowLinkForm(false);
    setLinkUrl("");
    setLinkTitle("");
  }

  function onAddNote() {
    const body = noteBody.trim();
    if (!body) {
      toast.error("Add some text.");
      return;
    }
    startTransition(async () => {
      const result = await addContextNote(engagementId, body, noteTitle.trim() || undefined);
      if (result.error || !result.item) {
        toast.error(result.error ?? "Couldn't add note.");
        return;
      }
      setItems((prev) => [result.item as ContextItem, ...prev]);
      resetNote();
    });
  }

  function onAddLink() {
    const url = linkUrl.trim();
    if (!url) {
      toast.error("Add a URL.");
      return;
    }
    startTransition(async () => {
      const result = await addContextLink(engagementId, url, linkTitle.trim() || undefined);
      if (result.error || !result.item) {
        toast.error(result.error ?? "Couldn't add link.");
        return;
      }
      setItems((prev) => [result.item as ContextItem, ...prev]);
      resetLink();
    });
  }

  function onFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!selected.length) return;
    startTransition(async () => {
      for (const file of selected) {
        const fd = new FormData();
        fd.append("engagement_id", engagementId);
        fd.append("kind", "document");
        fd.append("file", file);
        const result = await addContextDocument(fd);
        if (result.error || !result.item) {
          toast.error(`${file.name}: ${result.error ?? "upload failed"}`);
          continue;
        }
        setItems((prev) => [result.item as ContextItem, ...prev]);
      }
    });
  }

  function onDelete(id: string) {
    startTransition(async () => {
      const result = await deleteContextItem(id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setItems((prev) => prev.filter((i) => i.id !== id));
      setExpandedId((cur) => (cur === id ? null : cur));
    });
  }

  async function onOpen(item: ContextItem) {
    if (item.kind === "link" && item.url) {
      // Defense-in-depth: only follow plain http(s) URLs. normalizeUrl already
      // rejects javascript:/data:/etc. on write, but guard the open path too for
      // legacy rows or any link that bypassed it — never window.open a scheme
      // that could execute script.
      const href = safeExternalHref(item.url);
      if (href === "#") {
        toast.error("This link uses an unsupported URL scheme.");
        return;
      }
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    const result = await getContextItemSignedUrl(item.id);
    if (result.error || !result.url) {
      toast.error(result.error ?? "Couldn't open file.");
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  }

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) {
      setHits(null);
      return;
    }
    startSearch(async () => {
      const result = await searchClientContext(engagementId, q);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setHits(result.hits ?? []);
    });
  }

  return (
    <div className="docov docov-bare">
      <form onSubmit={onSearch} className="add-row" style={{ marginTop: 0, marginBottom: 12 }}>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!e.target.value.trim()) setHits(null);
          }}
          type="search"
          placeholder="Ask this client's knowledge… (semantic search)"
          className={inputClass}
          style={{ flex: 1 }}
        />
        <button type="submit" className="add-mini" disabled={isSearching}>
          <span className="ai"><Search size={14} strokeWidth={2} /></span>
          {isSearching ? "Searching…" : "Search"}
        </button>
      </form>

      <div className="add-row" style={{ marginTop: 0 }}>
        {showNoteForm ? (
          <>
            <button type="button" className="add-mini" onClick={onAddNote} disabled={isPending}>
              <span className="ai"><Plus size={14} strokeWidth={2} /></span>Save note
            </button>
            <button type="button" className="add-mini" onClick={resetNote} disabled={isPending}>
              Cancel
            </button>
          </>
        ) : showLinkForm ? (
          <>
            <button type="button" className="add-mini" onClick={onAddLink} disabled={isPending}>
              <span className="ai"><Plus size={14} strokeWidth={2} /></span>Save link
            </button>
            <button type="button" className="add-mini" onClick={resetLink} disabled={isPending}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="add-mini"
              onClick={() => setShowNoteForm(true)}
              disabled={isPending}
            >
              <span className="ai"><Plus size={14} strokeWidth={2} /></span>Add note
            </button>
            <button
              type="button"
              className="add-mini"
              onClick={() => setShowLinkForm(true)}
              disabled={isPending}
            >
              <span className="ai"><Plus size={14} strokeWidth={2} /></span>Add link
            </button>
            <button
              type="button"
              className="add-mini"
              onClick={() => fileInputRef.current?.click()}
              disabled={isPending}
            >
              <span className="ai"><Plus size={14} strokeWidth={2} /></span>Upload file
            </button>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={SOP_ACCEPT}
          onChange={onFilesSelected}
          className="hidden"
        />
      </div>

      {showNoteForm && (
        <div className="mt-3 flex flex-col gap-2">
          <input
            value={noteTitle}
            onChange={(e) => setNoteTitle(e.target.value)}
            type="text"
            placeholder="Title (optional) — e.g. Onboarding call notes"
            className={inputClass}
          />
          <textarea
            value={noteBody}
            onChange={(e) => setNoteBody(e.target.value)}
            rows={8}
            maxLength={MAX_SOP_CHARS}
            placeholder="Paste notes, an SOP, a transcript…"
            className="w-full rounded border border-neutral-200 px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-neutral-400"
            autoFocus
          />
          <div className="text-xs text-neutral-400">
            {noteBody.length.toLocaleString()} / {MAX_SOP_CHARS.toLocaleString()} chars
          </div>
        </div>
      )}

      {showLinkForm && (
        <div className="mt-3 flex flex-col gap-2">
          <input
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            type="text"
            placeholder="https://…"
            className={inputClass}
            autoFocus
          />
          <input
            value={linkTitle}
            onChange={(e) => setLinkTitle(e.target.value)}
            type="text"
            placeholder="Label (optional)"
            className={inputClass}
          />
        </div>
      )}

      {hits !== null && (
        <div className="rows" style={{ marginBottom: 12 }}>
          {hits.length === 0 ? (
            <div className="empty">No matches in this client&apos;s context.</div>
          ) : (
            <ul className="rows">
              {hits.map((h) => (
                <li key={h.chunkId} className="row" style={{ flexWrap: "wrap" }}>
                  <span className="row-ico">{kindIcon(h.item.kind as ContextItemKind)}</span>
                  <div className="row-main">
                    <div className="row-titleline">
                      <span className="row-name">{h.item.title}</span>
                      <span className="chip chip-kind">{Math.round(h.similarity * 100)}% match</span>
                    </div>
                    <div className="row-sub">
                      <span style={{ whiteSpace: "pre-wrap" }}>
                        {h.content.length > 240 ? h.content.slice(0, 240) + "…" : h.content}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Everything the graph shows, grouped by category. Non-context buckets
          come straight from the graph; the Context bucket renders the live,
          editable context items. */}
      <div className="ctx-list">
        {CAT_ORDER.map((cat) => {
          if (cat === "context") {
            return (
              <div key={cat} className="ctx-list-group">
                <CatGroupHead cat={cat} count={standaloneItems.length} />
                {standaloneItems.length > 0 ? (
                  <ul className="rows">
                    {standaloneItems.map((item) => (
                      <ContextItemRow
                        key={item.id}
                        item={item}
                        expanded={expandedId === item.id}
                        onToggle={() =>
                          setExpandedId((cur) => (cur === item.id ? null : item.id))
                        }
                        onOpen={onOpen}
                        onDelete={onDelete}
                        disabled={isPending}
                        showStatus={showIndexStatus}
                      />
                    ))}
                  </ul>
                ) : isSyncingDocs ? (
                  <div className="empty">Syncing this client&apos;s documents…</div>
                ) : (
                  <div className="empty">
                    Nothing here yet — upload a document, paste a note, or add a link. Text is
                    indexed so AI can use it later.
                  </div>
                )}
              </div>
            );
          }
          const ns = nodesByCat.get(cat);
          if (!ns || ns.length === 0) return null;
          return (
            <div key={cat} className="ctx-list-group">
              <CatGroupHead cat={cat} count={ns.length} />
              <ul className="rows">
                {ns.map((n) => (
                  <GraphNodeRow key={n.id} node={n} />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* One context-item row. Title toggles the inline content preview; the ⋯ kebab
   (and right-click) open a menu carrying Open + Remove — the affordances that
   used to be inline buttons. */
function ContextItemRow({
  item,
  expanded,
  onToggle,
  onOpen,
  onDelete,
  disabled,
  showStatus,
}: {
  item: ContextItem;
  expanded: boolean;
  onToggle: () => void;
  onOpen: (item: ContextItem) => void;
  onDelete: (id: string) => void;
  disabled: boolean;
  showStatus: boolean;
}) {
  const menu = useContextMenu();
  const chip = showStatus ? statusChip(item) : null;
  const canOpen = item.kind === "link" || !!item.storage_path;

  const menuItems: MenuItem[] = [
    ...(canOpen
      ? [
          {
            label: item.kind === "link" ? "Open link" : "Open file",
            icon: <ExternalLink size={15} strokeWidth={1.9} />,
            onSelect: () => onOpen(item),
          },
        ]
      : []),
    {
      label: "Remove",
      icon: <Trash2 size={15} strokeWidth={1.9} />,
      destructive: true,
      separatorBefore: canOpen,
      disabled,
      onSelect: () => onDelete(item.id),
    },
  ];

  return (
    <li className="row" style={{ flexWrap: "wrap" }} onContextMenu={menu.openAtEvent}>
      <span className="row-ico">{kindIcon(item.kind)}</span>
      <div className="row-main">
        <div className="row-titleline">
          <button
            type="button"
            className="row-name"
            onClick={onToggle}
            style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
          >
            {expanded ? (
              <ChevronDown size={14} strokeWidth={2} />
            ) : (
              <ChevronRight size={14} strokeWidth={2} />
            )}
            {item.title}
          </button>
          <span className="chip chip-kind">{item.kind}</span>
          {chip && <span className={`chip ${chip.tone}`}>{chip.label}</span>}
        </div>
        <div className="row-sub">
          <span>
            {[item.file_name, formatCount(item.char_count)].filter(Boolean).join(" · ")}
          </span>
        </div>
      </div>
      <button
        type="button"
        className="ctx-kebab"
        aria-label="Item actions"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          menu.openAtAnchor(e.currentTarget);
        }}
      >
        <MoreHorizontal size={16} strokeWidth={2} />
      </button>

      {expanded && item.content && (
        <div style={{ flexBasis: "100%", marginTop: 8 }}>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 280,
              overflow: "auto",
              margin: 0,
              padding: "10px 12px",
              fontSize: 12,
              lineHeight: 1.55,
              background: "#fafafa",
              border: "1px solid #ededed",
              borderRadius: 6,
              fontFamily: "inherit",
            }}
          >
            {item.content}
          </pre>
        </div>
      )}

      <ContextMenu state={menu.state} items={menuItems} onClose={menu.close} />
    </li>
  );
}

/* Section header for a category — colored swatch + label + count, matching the
   graph's legend so the two views read identically. */
function CatGroupHead({ cat, count }: { cat: CatKey; count: number }) {
  const meta = CATS[cat];
  return (
    <div className="ctx-list-head">
      <span className="ctx-list-sw" style={{ background: meta.color }} />
      <span className="ctx-list-title">{meta.label}</span>
      <span className="ctx-list-count">{count}</span>
    </div>
  );
}

/* One row for a graph entity (everything the graph shows except the editable
   context items). Links to the entity when it has a destination; otherwise a
   static, informational row. The colored icon + one-line note mirror the
   graph's node detail. */
function GraphNodeRow({ node }: { node: GraphNode }) {
  const cat = catOf(node.group);
  const meta = CATS[cat];
  const Icon = meta.Icon;
  const href = typeof node.meta?.href === "string" ? node.meta.href : null;

  const inner = (
    <>
      <span className="row-ico" style={{ color: meta.color }}>
        <Icon size={17} strokeWidth={1.9} />
      </span>
      <div className="row-main">
        <div className="row-titleline">
          <span className="row-name">{node.label}</span>
        </div>
        <div className="row-sub">
          <span>{noteOf(node)}</span>
        </div>
      </div>
      {href && <ArrowUpRight className="row-go" size={16} strokeWidth={1.9} />}
    </>
  );

  if (href) {
    return (
      <li>
        <Link href={href} className="row">
          {inner}
        </Link>
      </li>
    );
  }
  return <li className="row static">{inner}</li>;
}
