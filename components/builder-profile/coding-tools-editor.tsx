"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ExternalLink, Pencil, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BrandLogo } from "@/components/prd/brand-logo";
import {
  addCodingTools,
  updateCodingTool,
  deleteCodingTool,
  reorderCodingTools,
} from "@/lib/actions/builder-profile";
import { CODING_TOOL_PRESETS, findCodingToolPreset } from "@/lib/coding-tools";
import { safeExternalHref } from "@/lib/project/business-context";
import { CODING_TOOL_CATEGORIES, type BuilderProfileCodingTool } from "@/lib/types";

export function CodingToolsEditor({ entries }: { entries: BuilderProfileCodingTool[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function move(index: number, dir: -1 | 1) {
    const next = [...entries];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    startTransition(async () => {
      const result = await reorderCodingTools(next.map((e) => e.id));
      if (result.error) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  function remove(id: string) {
    if (!confirm("Remove this tool?")) return;
    startTransition(async () => {
      const result = await deleteCodingTool(id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {entries.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-200 px-4 py-6 text-center text-sm text-neutral-400">
          No coding tools added yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry, index) => (
            <li
              key={entry.id}
              className="flex items-start justify-between gap-3 rounded-md border border-neutral-200 bg-white p-4"
            >
              <div className="flex min-w-0 items-start gap-2.5">
                <BrandLogo
                  domain={findCodingToolPreset(entry.name)?.domain}
                  name={entry.name}
                  size={24}
                />
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
                    {entry.name}
                    {entry.url && (
                      <a
                        href={safeExternalHref(entry.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-neutral-400 hover:text-neutral-700"
                        aria-label={`Open ${entry.name}`}
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </p>
                  {entry.category && (
                    <span className="mt-1 inline-block rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500">
                      {entry.category}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={isPending || index === 0}
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-30"
                  aria-label="Move up"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={isPending || index === entries.length - 1}
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-30"
                  aria-label="Move down"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <EditCodingToolForm
                  entry={entry}
                  trigger={
                    <button
                      type="button"
                      className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                      aria-label="Edit tool"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  }
                />
                <button
                  type="button"
                  onClick={() => remove(entry.id)}
                  disabled={isPending}
                  className="rounded p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600"
                  aria-label="Delete tool"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <AddCodingToolsDialog entries={entries} />
    </div>
  );
}

/* Multi-select "Add coding tool" dialog: check any number of branded presets,
   optionally add one custom tool, and insert them all in a single action.
   Tools already on the profile show "Added" and can't be checked again. */
function AddCodingToolsDialog({ entries }: { entries: BuilderProfileCodingTool[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customName, setCustomName] = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [isPending, startTransition] = useTransition();

  // Names already on the profile (lowercased) — these presets can't be re-added.
  const addedNames = useMemo(
    () => new Set(entries.map((e) => e.name.trim().toLowerCase())),
    [entries]
  );

  // Popular tools, grouped by category and filtered by the search box.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CODING_TOOL_CATEGORIES.map((cat) => ({
      category: cat,
      items: CODING_TOOL_PRESETS.filter(
        (p) => p.category === cat && (!q || p.name.toLowerCase().includes(q))
      ),
    })).filter((g) => g.items.length > 0);
  }, [query]);

  // The exact rows that will be inserted — checked presets (in directory order)
  // plus the custom tool, deduped by name and minus anything already added.
  const pendingInputs = useMemo(() => {
    const seen = new Set(addedNames);
    const out: { name: string; category: string; url: string }[] = [];
    for (const preset of CODING_TOOL_PRESETS) {
      const key = preset.name.toLowerCase();
      if (selected.has(key) && !seen.has(key)) {
        seen.add(key);
        out.push({ name: preset.name, category: preset.category, url: preset.url });
      }
    }
    const cn = customName.trim();
    if (cn && !seen.has(cn.toLowerCase())) {
      out.push({ name: cn, category: customCategory, url: customUrl.trim() });
    }
    return out;
  }, [selected, customName, customCategory, customUrl, addedNames]);

  const count = pendingInputs.length;

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setQuery("");
      setSelected(new Set());
      setCustomName("");
      setCustomCategory("");
      setCustomUrl("");
    }
  }

  function submit() {
    if (!pendingInputs.length) return;
    startTransition(async () => {
      const result = await addCodingTools(pendingInputs);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      const n = result.count ?? pendingInputs.length;
      toast.success(`Added ${n} tool${n === 1 ? "" : "s"}`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Add tool
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add coding tools</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search popular tools…"
          />
          <div className="max-h-52 divide-y divide-neutral-100 overflow-y-auto rounded-md border border-neutral-200">
            {groups.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-neutral-400">
                No matches — add it as a custom tool below.
              </p>
            ) : (
              groups.map(({ category: cat, items }) => (
                <div key={cat}>
                  <p className="sticky top-0 bg-neutral-50 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-neutral-400">
                    {cat}
                  </p>
                  {items.map((preset) => {
                    const key = preset.name.toLowerCase();
                    const already = addedNames.has(key);
                    const checked = already || selected.has(key);
                    return (
                      <label
                        key={preset.name}
                        className={`flex items-center gap-2.5 px-3 py-2 text-sm ${
                          already
                            ? "cursor-default opacity-60"
                            : "cursor-pointer hover:bg-neutral-50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={already}
                          onChange={() => toggle(key)}
                          className="h-3.5 w-3.5 shrink-0 accent-neutral-700"
                        />
                        <BrandLogo domain={preset.domain} name={preset.name} size={20} />
                        <span className="flex-1 truncate text-neutral-800">{preset.name}</span>
                        {already && (
                          <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-400">
                            Added
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="h-px flex-1 bg-neutral-100" />
            <span className="text-[11px] text-neutral-400">or add a custom tool</span>
            <span className="h-px flex-1 bg-neutral-100" />
          </div>
          <div className="flex items-center gap-2.5">
            <BrandLogo
              domain={findCodingToolPreset(customName)?.domain}
              name={customName}
              size={24}
            />
            <Input
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="Tool name (e.g. Claude Code)"
              maxLength={80}
              className="flex-1"
            />
          </div>
          <select
            value={customCategory}
            onChange={(e) => setCustomCategory(e.target.value)}
            className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400"
            aria-label="Custom tool category"
          >
            <option value="">No category</option>
            {CODING_TOOL_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <Input
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            placeholder="Link (optional, e.g. claude.com/claude-code)"
            maxLength={500}
          />

          <Button onClick={submit} disabled={isPending || count === 0} className="w-full">
            {isPending
              ? "Adding…"
              : count === 0
                ? "Add tools"
                : `Add ${count} tool${count === 1 ? "" : "s"}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* Single-tool edit dialog (per-row pencil). The branded multi-select picker is
   only for adding; editing tweaks one existing tool's name/category/link. */
function EditCodingToolForm({
  entry,
  trigger,
}: {
  entry: BuilderProfileCodingTool;
  trigger: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(entry.name);
  const [category, setCategory] = useState<string>(entry.category ?? "");
  const [url, setUrl] = useState(entry.url ?? "");
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setName(entry.name);
      setCategory(entry.category ?? "");
      setUrl(entry.url ?? "");
    }
  }

  function save() {
    startTransition(async () => {
      const result = await updateCodingTool(entry.id, {
        name: name.trim(),
        category,
        url: url.trim(),
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Tool updated");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit tool</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="flex items-center gap-2.5">
            <BrandLogo domain={findCodingToolPreset(name)?.domain} name={name} size={24} />
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tool name (e.g. Claude Code)"
              maxLength={80}
              className="flex-1"
            />
          </div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400"
            aria-label="Category"
          >
            <option value="">No category</option>
            {CODING_TOOL_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Link (optional, e.g. claude.com/claude-code)"
            maxLength={500}
          />
          <Button onClick={save} disabled={isPending || !name.trim()} className="w-full">
            {isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
