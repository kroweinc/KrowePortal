"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Circle,
  Cloud,
  Database,
  FileText,
  Gauge,
  LayoutGrid,
  Loader2,
  Palette,
  Plug,
  Plus,
  Server,
  Shield,
  Sparkles,
  Square,
  SquareKanban,
  Tag,
  TrendingUp,
  TriangleAlert,
  User,
} from "lucide-react";
import { isBuilderOwnedDraft, type ExtractedTaskDraft } from "@/lib/ai/schemas";
import type { ApprovedTaskDraft } from "@/lib/actions/granola-import";
import type { AreaDefinition, TaskStatus, TaskTag } from "@/lib/types";
import { normalizeTitle } from "@/lib/tasks/dedupe";
import { GrSelect } from "@/components/granola/gr-select";
import { reconcileDraftRows } from "@/components/granola/review-reconcile";

type AreaIconComponent = React.ComponentType<{ size?: number; strokeWidth?: number }>;

// Icons for the FALLBACK taxonomy only. A repo-derived area ("checkout") has no
// icon to map to and gets the neutral Circle below — inventing an icon per slug
// would be guessing, and a wrong glyph reads louder than no glyph.
const TAG_ICON: Record<TaskTag, AreaIconComponent> = {
  ui: LayoutGrid,
  backend: Server,
  api: Plug,
  database: Database,
  auth: Shield,
  infra: Cloud,
  design: Palette,
  performance: Gauge,
  docs: FileText,
  growth: TrendingUp,
  ai: Sparkles,
};

const PRIO_OPTS = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];
const TYPE_OPTS = [
  { value: "feature", label: "Feature" },
  { value: "bug", label: "Bug" },
  { value: "change", label: "Change" },
];
/** The Area select's options for a given vocabulary. "No tag" stays first: a
    draft the call gave no area for is a real outcome, not a missing value. */
function areaOptions(areas: AreaDefinition[]) {
  return [{ value: "", label: "No tag" }, ...areas.map((a) => ({ value: a.slug, label: a.label }))];
}

/** The icon for one stored area. Repo areas fall through to Circle.
 *  Uses hasOwn, not a bare index: a derived slug like "constructor" or
 *  "toString" would otherwise resolve up the prototype chain to a truthy
 *  non-component, slip past the `|| Circle` fallback, and white-screen the whole
 *  review dialog with "Objects are not valid as a React child". */
function areaIcon(slug: string | undefined): AreaIconComponent {
  return slug && Object.hasOwn(TAG_ICON, slug) ? TAG_ICON[slug as TaskTag] : Circle;
}
// Creating straight into Done would skip the approval gate, so it's not offered.
type LandingStatus = Exclude<TaskStatus, "done">;
const STATUS_OPTS: { value: LandingStatus; label: string }[] = [
  { value: "backlog", label: "Backlog" },
  { value: "todo", label: "To-Do" },
  { value: "in_progress", label: "In Progress" },
];

interface ReviewRow extends ExtractedTaskDraft {
  selected: boolean;
  expanded: boolean;
  status: LandingStatus;
}

// Sizes a textarea to its own content so a review row never hides text behind a
// fixed height. `max` caps the growth — past it the field scrolls rather than
// letting one long draft push everything else off screen.
function useAutoGrow(value: string, max?: number) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Collapse first so the measured scrollHeight is the content's, not the
    // previous (taller) box's. Re-runs on resize because the wrap point moves
    // with the modal's width.
    const fit = () => {
      el.style.height = "auto";
      const overflows = max !== undefined && el.scrollHeight > max;
      el.style.height = `${overflows ? max : el.scrollHeight}px`;
      el.style.overflowY = overflows ? "auto" : "hidden";
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [value, max]);

  return ref;
}

// Extracted titles run long, and a one-line <input> hid the tail of them behind
// whatever pills the draft happened to carry. A textarea sized to its own
// content wraps instead, so the whole title is readable while staying editable.
function TaskTitleField({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  const ref = useAutoGrow(value);

  return (
    <textarea
      ref={ref}
      className="krowe-gr-title-input"
      rows={1}
      value={value}
      // A title is one line of text; paste keeps its words, not its newlines.
      onChange={(e) => onChange(e.target.value.replace(/\s*\n+\s*/g, " "))}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.preventDefault();
      }}
      disabled={disabled}
      aria-label="Task title"
    />
  );
}

// Past ~11 lines a description is long enough that scrolling it beats pushing
// the rest of the review out of reach.
const DESC_MAX_HEIGHT = 220;

function TaskDescriptionField({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  const ref = useAutoGrow(value, DESC_MAX_HEIGHT);

  return (
    <textarea
      ref={ref}
      className="krowe-gr-desc"
      rows={2}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder="Add a description…"
      aria-label="Task description"
    />
  );
}

// The builder's own work starts checked; action items the call assigned to
// someone else (client homework, teammates) start unchecked so they only land
// on the board when explicitly opted in.
function toRow(d: ExtractedTaskDraft): ReviewRow {
  return { ...d, selected: isBuilderOwnedDraft(d.owner), expanded: false, status: "backlog" };
}

export function GranolaTaskReview({
  drafts,
  areas,
  duplicateMatches = {},
  submitting,
  streaming = false,
  sourceLabel = "from the call",
  onSubmit,
  onCancel,
}: {
  drafts: ExtractedTaskDraft[];
  /** The vocabulary the drafts were classified against, so the Area select
      offers exactly the labels the model was allowed to pick. Empty falls the
      select back to whatever each row already carries. */
  areas: AreaDefinition[];
  /** Normalized draft title → an existing OPEN task it likely duplicates. Drives
      the "Possible duplicate" badge and a one-time default-uncheck. */
  duplicateMatches?: Record<string, { id: string; title: string }>;
  submitting: boolean;
  /** True while drafts are still streaming in — rows append live and the
      Create button stays disabled until the final (authoritative) list lands. */
  streaming?: boolean;
  /** Attribution under the transcript quote — e.g. "from the call". */
  sourceLabel?: string;
  onSubmit: (items: ApprovedTaskDraft[]) => void;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState<ReviewRow[]>(drafts.map(toRow));
  const tagOpts = useMemo(() => areaOptions(areas), [areas]);
  const [prevStreaming, setPrevStreaming] = useState(streaming);
  // Titles already auto-unchecked, so re-checking a flagged row sticks instead
  // of being undone the next time matches resolve.
  const autoUncheckedRef = useRef<Set<string>>(new Set());

  // Streaming appends raw per-item drafts; the `done` payload swaps in the
  // finalized array (owner repairs, merges, synthesized tasks) — possibly at
  // the same length as what streamed, so the stream-end transition, not the
  // length, is the rebuild signal. Adjust during render (React's "derived
  // state" pattern); reconcileDraftRows holds the decision logic.
  const nextRows = reconcileDraftRows(rows, drafts, streaming, prevStreaming, toRow);
  if (streaming !== prevStreaming) setPrevStreaming(streaming);
  if (nextRows) setRows(nextRows);

  // When duplicate matches resolve (async, after the final list lands), uncheck
  // each newly-flagged row once. Builder-owned tasks default checked; a likely
  // duplicate shouldn't, so it only lands on the board if explicitly opted in.
  useEffect(() => {
    const fresh = Object.keys(duplicateMatches).filter((k) => !autoUncheckedRef.current.has(k));
    if (fresh.length === 0) return;
    fresh.forEach((k) => autoUncheckedRef.current.add(k));
    const set = new Set(fresh);
    setRows((prev) =>
      prev.map((row) => (set.has(normalizeTitle(row.title)) ? { ...row, selected: false } : row))
    );
  }, [duplicateMatches]);

  const selectedCount = rows.filter((r) => r.selected).length;
  const allSelected = rows.length > 0 && selectedCount === rows.length;

  function patchRow(index: number, patch: Partial<ReviewRow>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function toggleAll() {
    setRows((prev) => prev.map((row) => ({ ...row, selected: !allSelected })));
  }

  function submit() {
    const items = rows
      .filter((r) => r.selected && r.title.trim().length >= 3)
      .map(({ selected: _s, expanded: _e, ...draft }) => ({
        ...draft,
        title: draft.title.trim(),
        description: draft.description.trim(),
      }));
    if (items.length > 0) onSubmit(items);
  }

  return (
    <>
      <div className="krowe-gr-body">
        <div className="krowe-gr-review-bar">
          <div className="krowe-gr-count">
            {streaming ? (
              <>
                <Loader2 size={13} className="animate-spin" style={{ verticalAlign: "-2px" }} />{" "}
                Drafting tasks — <strong>{rows.length}</strong> found so far…
              </>
            ) : (
              <>
                <strong>{selectedCount}</strong> of {rows.length} selected
              </>
            )}
          </div>
          <button
            type="button"
            className="krowe-gr-selall"
            onClick={toggleAll}
            disabled={submitting || streaming}
          >
            {allSelected ? <Square size={14} strokeWidth={2} /> : <CheckSquare size={14} strokeWidth={2} />}
            {allSelected ? "Deselect all" : "Select all"}
          </button>
        </div>

        {rows.map((row, i) => {
          const AreaIcon = areaIcon(row.tags[0]);
          const dupe = duplicateMatches[normalizeTitle(row.title)];
          const hasMeta =
            !isBuilderOwnedDraft(row.owner) || !!dupe || row.confidence !== "high";
          return (
            <div key={i} className={`krowe-gr-task prio-${row.priority}${row.selected ? "" : " off"}`}>
              <span className="krowe-gr-task-rail" />
              <div className="krowe-gr-task-top">
                <button
                  type="button"
                  className={`krowe-gr-check${row.selected ? " on" : ""}`}
                  onClick={() => patchRow(i, { selected: !row.selected })}
                  disabled={submitting || streaming}
                  role="checkbox"
                  aria-checked={row.selected}
                  aria-label={`Include "${row.title}"`}
                >
                  {row.selected && <Check size={13} strokeWidth={3} />}
                </button>
                <TaskTitleField
                  value={row.title}
                  disabled={submitting || streaming || !row.selected}
                  onChange={(title) => patchRow(i, { title })}
                />
                <button
                  type="button"
                  className="krowe-gr-details-btn"
                  onClick={() => patchRow(i, { expanded: !row.expanded })}
                  disabled={streaming}
                >
                  {row.expanded ? (
                    <ChevronDown size={14} strokeWidth={2} />
                  ) : (
                    <ChevronRight size={14} strokeWidth={2} />
                  )}
                  Details{row.checklist.length > 0 ? ` (${row.checklist.length})` : ""}
                </button>
              </div>

              {/* Qualifiers sit on their own row so however many a draft carries,
                  none of them steal width from the title. */}
              {hasMeta && (
                <div className="krowe-gr-task-meta">
                  {!isBuilderOwnedDraft(row.owner) && (
                    <span
                      className="krowe-gr-owner"
                      title={`The call assigned this to ${row.owner} — it starts unchecked and only lands on your board if you include it.`}
                    >
                      <User size={11} strokeWidth={2} /> {row.owner}
                    </span>
                  )}
                  {dupe && (
                    <span
                      className="krowe-gr-dupe"
                      title={`Looks like an existing task: "${dupe.title}". Unchecked by default — include it only if it's genuinely new.`}
                    >
                      <TriangleAlert size={11} strokeWidth={2} /> Possible duplicate
                    </span>
                  )}
                  {row.confidence !== "high" && (
                    <span
                      className={`krowe-gr-conf${row.confidence === "low" ? " low" : ""}`}
                      title="The AI wasn't fully sure this was explicitly assigned — double-check it against the call."
                    >
                      {row.confidence} confidence
                    </span>
                  )}
                </div>
              )}

              {/* Collapsed rows still say what the task is — Details opens it for
                  editing rather than being the only way to read it. */}
              {!row.expanded && row.description.trim().length > 0 && (
                <p className="krowe-gr-task-desc">{row.description}</p>
              )}

              <div className="krowe-gr-task-controls">
                <label className="krowe-gr-field">
                  <span className="krowe-gr-field-cap">Priority</span>
                  <GrSelect
                    value={row.priority}
                    onChange={(v) => patchRow(i, { priority: v as ReviewRow["priority"] })}
                    options={PRIO_OPTS}
                    tone={row.priority}
                    leading={<span className="swatch" />}
                    disabled={submitting || streaming || !row.selected}
                    ariaLabel="Priority"
                  />
                </label>
                <label className="krowe-gr-field">
                  <span className="krowe-gr-field-cap">Type</span>
                  <GrSelect
                    value={row.type}
                    onChange={(v) => patchRow(i, { type: v as ReviewRow["type"] })}
                    options={TYPE_OPTS}
                    leading={<Tag size={13} strokeWidth={2} />}
                    disabled={submitting || streaming || !row.selected}
                    ariaLabel="Type"
                  />
                </label>
                <label className="krowe-gr-field">
                  <span className="krowe-gr-field-cap">Area</span>
                  <GrSelect
                    value={row.tags[0] ?? ""}
                    onChange={(v) => patchRow(i, { tags: v ? [v] : [] })}
                    options={tagOpts}
                    leading={<AreaIcon size={13} strokeWidth={2} />}
                    disabled={submitting || streaming || !row.selected}
                    ariaLabel="Area"
                  />
                </label>
                <label className="krowe-gr-field">
                  <span className="krowe-gr-field-cap">Lands in</span>
                  <GrSelect
                    value={row.status}
                    onChange={(v) => patchRow(i, { status: v as LandingStatus })}
                    options={STATUS_OPTS}
                    leading={<SquareKanban size={13} strokeWidth={2} />}
                    disabled={submitting || streaming || !row.selected}
                    ariaLabel="Lands in"
                  />
                </label>
              </div>

              {row.expanded && (
                <div className="krowe-gr-details">
                  <TaskDescriptionField
                    value={row.description}
                    disabled={submitting || streaming || !row.selected}
                    onChange={(description) => patchRow(i, { description })}
                  />
                  {row.checklist.length > 0 && (
                    <ul className="krowe-gr-checklist" aria-label="Checklist">
                      {row.checklist.map((entry, ci) => (
                        <li key={ci}>
                          <CheckSquare size={13} strokeWidth={2} />
                          <span>{entry}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {row.dependencies.map((dep, di) => (
                    <div key={di} className="krowe-gr-dep">
                      <User size={13} strokeWidth={2} />
                      <span>
                        Waiting on <strong>{dep.owner}</strong>: {dep.requirement}
                      </span>
                    </div>
                  ))}
                  {row.sourceQuote && (
                    <div className="krowe-gr-quote">
                      <div className="q">&ldquo;{row.sourceQuote}&rdquo;</div>
                      <div className="qm">
                        <AudioLines size={11} strokeWidth={2} /> {sourceLabel}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="krowe-gr-foot">
        <span className="hint">These land on your board.</span>
        <div className="actions">
          <button type="button" className="krowe-gr-btn ghost" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            className="krowe-gr-btn primary lg"
            onClick={submit}
            disabled={submitting || streaming || selectedCount === 0}
          >
            {submitting || streaming ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Plus size={16} strokeWidth={2.25} />
            )}
            {submitting
              ? "Creating…"
              : streaming
                ? "Drafting…"
                : `Create ${selectedCount} task${selectedCount === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </>
  );
}
