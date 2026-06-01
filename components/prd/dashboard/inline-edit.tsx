"use client";

/* Inline-edit primitives for the PRD dashboard.
   In read/preview mode these render as plain text. In edit mode every field
   becomes click-to-edit in place. Ported from the Claude Design prototype. */

import {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  type ReactNode,
} from "react";

// Whether the dashboard is currently in Edit mode (click-to-edit live).
export const EditContext = createContext<{ editing: boolean }>({ editing: false });
export const useEditing = () => useContext(EditContext).editing;

// Auto-grow a textarea to fit its content.
function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

type InlineTag = "span" | "p" | "h1" | "div";

interface InlineTextProps {
  value?: string | null;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
  className?: string;
  tag?: InlineTag;
  serif?: boolean;
  mono?: boolean;
}

/* InlineText — a single editable text field that reads as plain text until clicked. */
export function InlineText({
  value,
  onChange,
  multiline = false,
  placeholder = "Empty",
  className = "",
  tag = "span",
  serif = false,
  mono = false,
}: InlineTextProps) {
  const editing = useEditing();
  const [active, setActive] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  // Sync the draft from props only while not actively editing, so a parent
  // re-hydrate (e.g. after Save → router.refresh()) can't clobber an in-flight edit.
  useEffect(() => {
    if (!active) setDraft(value ?? "");
  }, [value, active]);

  useLayoutEffect(() => {
    if (active && ref.current) {
      ref.current.focus();
      if (multiline) autoGrow(ref.current);
      const v = ref.current.value;
      ref.current.setSelectionRange(v.length, v.length);
    }
  }, [active, multiline]);

  const Tag = tag;
  const familyStyle = serif
    ? { fontFamily: "var(--font-serif)" }
    : mono
    ? { fontFamily: "var(--font-mono)" }
    : undefined;

  function commit() {
    setActive(false);
    if (draft !== (value ?? "")) onChange(draft);
  }

  if (!editing) {
    // Read mode — plain text (empty fields collapse to nothing in preview).
    if (!value && placeholder) return null;
    return (
      <Tag className={className} style={familyStyle}>
        {value}
      </Tag>
    );
  }

  if (active) {
    const common = {
      ref,
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => {
        setDraft(e.target.value);
        if (multiline) autoGrow(e.target);
      },
      onBlur: commit,
      placeholder,
      className: "inline-input " + className,
      style: familyStyle,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Escape") {
          setDraft(value ?? "");
          setActive(false);
        }
        if (e.key === "Enter" && !multiline) {
          e.preventDefault();
          commit();
        }
      },
    };
    return multiline ? <textarea rows={1} {...common} /> : <input type="text" {...common} />;
  }

  const empty = !value;
  return (
    <Tag
      className={"inline-editable " + (empty ? "inline-empty " : "") + className}
      style={familyStyle}
      tabIndex={0}
      onClick={() => setActive(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          setActive(true);
        }
      }}
    >
      {value || placeholder}
    </Tag>
  );
}

interface InlineSelectOption {
  value: string;
  label: string;
}

interface InlineSelectProps {
  value?: string | null;
  onChange: (v: string) => void;
  options: InlineSelectOption[];
  render?: (v: string) => ReactNode;
}

/* InlineSelect — small dropdown shown only in edit mode; a styled label otherwise. */
export function InlineSelect({ value, onChange, options, render }: InlineSelectProps) {
  const editing = useEditing();
  const label = render ? render(value ?? "") : value;
  if (!editing) return label ? <span className="inline-tag">{label}</span> : null;
  return (
    <select className="inline-select" value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

type ListVariant = "bullet" | "ordered" | "check" | "plain";

interface InlineListProps {
  items?: string[];
  onChange: (items: string[]) => void;
  variant?: ListVariant;
  placeholder?: string;
  addLabel?: string;
}

/* InlineList — list whose items are each inline-editable, with hover-remove and add row. */
export function InlineList({
  items = [],
  onChange,
  variant = "bullet",
  placeholder = "Item",
  addLabel = "Add",
}: InlineListProps) {
  const editing = useEditing();
  const update = (i: number, v: string) => onChange(items.map((it, idx) => (idx === i ? v : it)));
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const add = () => onChange([...items, ""]);

  if (!editing && items.length === 0) return null;

  return (
    <ul className={"inline-list inline-list--" + variant}>
      {items.map((it, i) => (
        <li key={i} className="inline-list__item">
          <span className="inline-list__marker" aria-hidden="true">
            {variant === "ordered" ? i + 1 + "." : variant === "check" ? "✓" : variant === "plain" ? "" : "•"}
          </span>
          <InlineText
            value={it}
            onChange={(v) => update(i, v)}
            placeholder={placeholder}
            className="inline-list__text"
            multiline
          />
          {editing && (
            <button type="button" className="inline-remove" onClick={() => remove(i)} aria-label="Remove">
              ×
            </button>
          )}
        </li>
      ))}
      {editing && (
        <li className="inline-list__add">
          <button type="button" className="inline-add" onClick={add}>
            + {addLabel}
          </button>
        </li>
      )}
    </ul>
  );
}

/* AddButton — standalone "+ Add X" affordance for structured card lists. */
export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  if (!useEditing()) return null;
  return (
    <button type="button" className="inline-add inline-add--block" onClick={onClick}>
      + {label}
    </button>
  );
}

/* RemoveCard — small × in the corner of a structured card (edit mode only). */
export function RemoveCard({ onClick }: { onClick: () => void }) {
  if (!useEditing()) return null;
  return (
    <button type="button" className="card-remove" onClick={onClick} aria-label="Remove">
      ×
    </button>
  );
}
