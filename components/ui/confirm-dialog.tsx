"use client";

/* Branded confirm modal — a drop-in replacement for the native window.confirm().
   Use the `useConfirm` hook: it hands back an async `confirm(opts) => Promise<boolean>`
   plus a `<dialog>` element to drop into your JSX. Call sites read almost exactly
   like the old imperative confirm:

       const [confirm, confirmDialog] = useConfirm();
       if (!(await confirm({ title: "…", description: "…" }))) return;
       …
       return (<>…{confirmDialog}</>);

   Resolves true on confirm, false on cancel / overlay / escape / X. */

import * as React from "react";
import { AlertTriangle, type LucideIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export type ConfirmTone = "brand" | "danger";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  tone?: ConfirmTone;
  /** Icon shown in the badge. Defaults to a tone-appropriate glyph. */
  icon?: LucideIcon;
}

type ConfirmState = ConfirmOptions & { open: boolean };

export function useConfirm(): [
  (opts: ConfirmOptions) => Promise<boolean>,
  React.ReactNode,
] {
  const [state, setState] = React.useState<ConfirmState>({ open: false, title: "" });
  const resolver = React.useRef<((value: boolean) => void) | null>(null);

  const confirm = React.useCallback((opts: ConfirmOptions) => {
    setState({ ...opts, open: true });
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  // Settle the pending promise exactly once, then close. Keep the copy mounted so
  // the close animation doesn't flash empty content.
  const settle = React.useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setState((s) => ({ ...s, open: false }));
  }, []);

  const dialog = (
    <ConfirmDialog
      state={state}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );

  return [confirm, dialog];
}

function ConfirmDialog({
  state,
  onConfirm,
  onCancel,
}: {
  state: ConfirmState;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const {
    open,
    title,
    description,
    confirmText = "Confirm",
    cancelText = "Cancel",
    tone = "brand",
    icon: Icon = tone === "danger" ? AlertTriangle : undefined,
  } = state;

  const danger = tone === "danger";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-sm gap-0 p-0 overflow-hidden">
        <div className="flex gap-4 p-6">
          {Icon && (
            <span
              aria-hidden="true"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full"
              style={{
                background: danger ? "var(--danger-soft)" : "var(--primary-soft)",
                color: danger ? "var(--danger)" : "var(--primary)",
              }}
            >
              <Icon className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0 pt-0.5">
            <DialogTitle
              className="text-[15px] font-semibold leading-snug"
              style={{ color: "var(--foreground)" }}
            >
              {title}
            </DialogTitle>
            {description && (
              <DialogDescription
                className="mt-1.5 text-sm leading-relaxed"
                style={{ color: "var(--muted-foreground)" }}
              >
                {description}
              </DialogDescription>
            )}
          </div>
        </div>

        <div
          className="flex items-center justify-center gap-2 px-6 py-4"
          style={{ borderTop: "1px solid var(--border)", background: "var(--surface-subtle)" }}
        >
          <button
            type="button"
            onClick={onCancel}
            className="h-9 rounded-[10px] px-4 text-sm font-medium transition-colors"
            style={{
              border: "1px solid var(--border)",
              color: "var(--foreground)",
              background: "var(--background)",
            }}
          >
            {cancelText}
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            className="inline-flex h-9 items-center gap-2 rounded-[10px] px-4 text-sm font-semibold text-white shadow-sm transition-[filter,box-shadow]"
            style={{ background: danger ? "var(--danger)" : "var(--primary)" }}
            onMouseEnter={(e) => (e.currentTarget.style.filter = "brightness(0.94)")}
            onMouseLeave={(e) => (e.currentTarget.style.filter = "")}
          >
            {Icon && !danger && <Icon className="h-3.5 w-3.5" />}
            {confirmText}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Branded text-input modal — drop-in replacement for window.prompt() ──
   Resolves to the entered string on confirm (empty string allowed unless
   `required`), or null on cancel / overlay / escape.

       const [prompt, promptDialog] = usePrompt();
       const note = await prompt({ title: "Add a note", placeholder: "…" });
       if (note === null) return; // cancelled
*/

export interface PromptOptions {
  title: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
  multiline?: boolean;
  /** When true, an empty value can't be submitted. */
  required?: boolean;
}

type PromptState = PromptOptions & { open: boolean };

export function usePrompt(): [
  (opts: PromptOptions) => Promise<string | null>,
  React.ReactNode,
] {
  const [state, setState] = React.useState<PromptState>({ open: false, title: "" });
  const resolver = React.useRef<((value: string | null) => void) | null>(null);

  const prompt = React.useCallback((opts: PromptOptions) => {
    setState({ ...opts, open: true });
    return new Promise<string | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = React.useCallback((value: string | null) => {
    resolver.current?.(value);
    resolver.current = null;
    setState((s) => ({ ...s, open: false }));
  }, []);

  const dialog = (
    <PromptDialog
      state={state}
      onSubmit={(v) => settle(v)}
      onCancel={() => settle(null)}
    />
  );

  return [prompt, dialog];
}

function PromptDialog({
  state,
  onSubmit,
  onCancel,
}: {
  state: PromptState;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const {
    open,
    title,
    description,
    placeholder,
    defaultValue = "",
    confirmText = "Save",
    cancelText = "Cancel",
    multiline = false,
    required = false,
  } = state;

  const [value, setValue] = React.useState(defaultValue);

  // Reset the field each time the modal opens so a fresh prompt starts clean.
  React.useEffect(() => {
    if (open) setValue(defaultValue);
  }, [open, defaultValue]);

  const canSubmit = !required || value.trim().length > 0;
  const submit = () => {
    if (canSubmit) onSubmit(value);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-sm gap-0 p-0 overflow-hidden">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="px-6 pt-6 pb-4">
            <DialogTitle
              className="text-[15px] font-semibold leading-snug"
              style={{ color: "var(--foreground)" }}
            >
              {title}
            </DialogTitle>
            {description && (
              <DialogDescription
                className="mt-1.5 text-sm leading-relaxed"
                style={{ color: "var(--muted-foreground)" }}
              >
                {description}
              </DialogDescription>
            )}
            {multiline ? (
              <textarea
                autoFocus
                rows={4}
                value={value}
                placeholder={placeholder}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
                }}
                className="mt-3 w-full resize-none rounded-[10px] px-3 py-2 text-sm outline-none transition-shadow"
                style={{ border: "1px solid var(--border)", color: "var(--foreground)", background: "var(--background)" }}
              />
            ) : (
              <input
                autoFocus
                type="text"
                value={value}
                placeholder={placeholder}
                onChange={(e) => setValue(e.target.value)}
                className="mt-3 w-full rounded-[10px] px-3 py-2 text-sm outline-none transition-shadow"
                style={{ border: "1px solid var(--border)", color: "var(--foreground)", background: "var(--background)" }}
              />
            )}
          </div>

          <div
            className="flex items-center justify-center gap-2 px-6 py-4"
            style={{ borderTop: "1px solid var(--border)", background: "var(--surface-subtle)" }}
          >
            <button
              type="button"
              onClick={onCancel}
              className="h-9 rounded-[10px] px-4 text-sm font-medium transition-colors"
              style={{ border: "1px solid var(--border)", color: "var(--foreground)", background: "var(--background)" }}
            >
              {cancelText}
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex h-9 items-center gap-2 rounded-[10px] px-4 text-sm font-semibold text-white shadow-sm transition-[filter,box-shadow] disabled:opacity-50"
              style={{ background: "var(--primary)" }}
            >
              {confirmText}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
