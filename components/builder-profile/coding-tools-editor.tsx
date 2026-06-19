"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Plus, Search, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BrandLogo } from "@/components/prd/brand-logo";
import { addCodingTools, deleteCodingTool } from "@/lib/actions/builder-profile";
import { CODING_TOOL_PRESETS, findCodingToolPreset } from "@/lib/coding-tools";
import { CODING_TOOL_CATEGORIES, type BuilderProfileCodingTool } from "@/lib/types";

// Warm-token overrides so the picker's inputs match the Krowe palette instead
// of the primitive's default cold-gray border + dark focus ring.
const WARM_INPUT =
  "border-[var(--border)] focus:border-[var(--primary)] focus:ring-0 focus:ring-offset-0";

// Brand "ember" mark used in the picker title (concentric warm circles).
function Ember() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill="var(--primary)" opacity="0.2" />
      <circle cx="8" cy="8" r="4" fill="var(--primary)" opacity="0.4" />
      <circle cx="8" cy="8" r="2.5" fill="var(--primary)" />
      <circle cx="9" cy="7" r="1" fill="var(--primary-accent)" />
    </svg>
  );
}

export function CodingToolsEditor({ entries }: { entries: BuilderProfileCodingTool[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Instant, frictionless removal (no per-row confirm) — the autosave model.
  function remove(id: string) {
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
    <div className="space-y-3.5">
      {entries.length === 0 ? (
        <p className="tool-empty">No coding tools added yet.</p>
      ) : (
        <div className="tool-grid">
          {entries.map((entry) => (
            <div key={entry.id} className="tool-tile">
              <BrandLogo
                domain={findCodingToolPreset(entry.name)?.domain}
                name={entry.name}
                size={30}
              />
              <div className="info">
                <div className="nm" title={entry.name}>
                  {entry.name}
                </div>
                {entry.category && <div className="ct">{entry.category}</div>}
              </div>
              <button
                type="button"
                onClick={() => remove(entry.id)}
                disabled={isPending}
                className="tool-rm disabled:opacity-40"
                aria-label={`Remove ${entry.name}`}
              >
                <X />
              </button>
            </div>
          ))}
        </div>
      )}
      <AddCodingToolsDialog entries={entries} />
    </div>
  );
}

interface PendingCustom {
  name: string;
  category: string;
  url: string;
}

/* "Add coding tools" picker: search + category filter chips, selectable branded
   tiles (with an "Added" state for tools already on the profile), a custom-tool
   builder, and a live selected-count footer. Inserts the whole batch in one
   action. Ported from the Krowe Design handoff (Profile Setup · Smart Scroll). */
function AddCodingToolsDialog({ entries }: { entries: BuilderProfileCodingTool[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState<string>("All");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customs, setCustoms] = useState<PendingCustom[]>([]);
  const [customName, setCustomName] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const [isPending, startTransition] = useTransition();

  // Names already on the profile (lowercased) — these presets show "Added".
  const addedNames = useMemo(
    () => new Set(entries.map((e) => e.name.trim().toLowerCase())),
    [entries]
  );

  // Categories that actually have presets, in canonical order, each with a count.
  const categories = useMemo(() => {
    return CODING_TOOL_CATEGORIES.map((cat) => ({
      cat,
      count: CODING_TOOL_PRESETS.filter((p) => p.category === cat).length,
    })).filter((c) => c.count > 0);
  }, []);

  // Preset tiles grouped by category, filtered by the active chip + search box.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const cats = activeCat === "All" ? categories.map((c) => c.cat) : [activeCat];
    return cats
      .map((cat) => ({
        cat,
        items: CODING_TOOL_PRESETS.filter(
          (p) => p.category === cat && (!q || p.name.toLowerCase().includes(q))
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [activeCat, query, categories]);

  const count = selected.size + customs.length;

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function addCustom() {
    const name = customName.trim();
    if (!name) return;
    setCustoms((prev) => [
      ...prev,
      { name, category: customCategory, url: customUrl.trim() },
    ]);
    setCustomName("");
    setCustomUrl("");
    setCustomCategory("");
  }

  function removeCustom(index: number) {
    setCustoms((prev) => prev.filter((_, i) => i !== index));
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setQuery("");
      setActiveCat("All");
      setSelected(new Set());
      setCustoms([]);
      setCustomName("");
      setCustomUrl("");
      setCustomCategory("");
    }
  }

  function submit() {
    if (!count) return;
    const inputs = [
      ...CODING_TOOL_PRESETS.filter((p) => selected.has(p.name)).map((p) => ({
        name: p.name,
        category: p.category,
        url: p.url,
      })),
      ...customs.map((c) => ({ name: c.name, category: c.category, url: c.url })),
    ];
    startTransition(async () => {
      const result = await addCodingTools(inputs);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      const n = result.count ?? inputs.length;
      toast.success(`Added ${n} tool${n === 1 ? "" : "s"}`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          <Plus className="h-4 w-4" /> Add tool
        </Button>
      </DialogTrigger>
      <DialogContent className="ctm-shell flex flex-col gap-0 overflow-hidden p-0 w-[560px] max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-3rem)] rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--background)]">
        <div className="ctm-head">
          <div className="row">
            <DialogTitle asChild>
              <h3>
                <span className="ember">
                  <Ember />
                </span>
                Add coding tools
              </h3>
            </DialogTitle>
          </div>
          <DialogDescription asChild>
            <p>Pick from the stack you build with — clients recognize them.</p>
          </DialogDescription>
          <div className="ctm-search">
            <Search />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search popular tools…"
              className={`pl-9 ${WARM_INPUT}`}
            />
          </div>
        </div>

        <div className="ctm-cats">
          <button
            type="button"
            className={`ctm-cat ${activeCat === "All" ? "on" : ""}`}
            onClick={() => setActiveCat("All")}
          >
            All <span className="n">{CODING_TOOL_PRESETS.length}</span>
          </button>
          {categories.map(({ cat, count: n }) => (
            <button
              key={cat}
              type="button"
              className={`ctm-cat ${activeCat === cat ? "on" : ""}`}
              onClick={() => setActiveCat(cat)}
            >
              {cat} <span className="n">{n}</span>
            </button>
          ))}
        </div>

        <div className="ctm-body">
          {customs.length > 0 && (
            <>
              <p className="ctm-catlabel">Your custom tools</p>
              <div className="ctm-grid">
                {customs.map((c, i) => (
                  <button
                    key={`${c.name}-${i}`}
                    type="button"
                    className="ctm-tile sel"
                    onClick={() => removeCustom(i)}
                  >
                    <BrandLogo name={c.name} size={30} />
                    <span className="info">
                      <span className="nm">{c.name}</span>
                      <span className="ct">{c.category || "Custom"}</span>
                    </span>
                    <span className="check">
                      <X />
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {groups.length === 0 && customs.length === 0 ? (
            <div className="ctm-empty">
              No tools match “{query}”. Add it as a custom tool below.
            </div>
          ) : (
            groups.map(({ cat, items }) => (
              <div key={cat}>
                <p className="ctm-catlabel">{cat}</p>
                <div className="ctm-grid">
                  {items.map((preset) => {
                    const added = addedNames.has(preset.name.toLowerCase());
                    const sel = selected.has(preset.name);
                    return (
                      <button
                        key={preset.name}
                        type="button"
                        disabled={added}
                        onClick={() => toggle(preset.name)}
                        className={`ctm-tile ${added ? "added" : ""} ${sel ? "sel" : ""}`}
                      >
                        <BrandLogo domain={preset.domain} name={preset.name} size={30} />
                        <span className="info">
                          <span className="nm">{preset.name}</span>
                          <span className="ct">{preset.category}</span>
                        </span>
                        {added ? (
                          <span className="added-pill">
                            <Check /> Added
                          </span>
                        ) : (
                          <span className="check">
                            <Check />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}

          <div className="ctm-custom">
            <div className="lab">Add a custom tool</div>
            <div className="ctm-cform">
              <BrandLogo name={customName} size={42} />
              <div className="ctm-cfields">
                <Input
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCustom();
                    }
                  }}
                  placeholder="Tool name — e.g. Linear"
                  maxLength={80}
                  className={WARM_INPUT}
                />
                <div className="two">
                  <Input
                    value={customUrl}
                    onChange={(e) => setCustomUrl(e.target.value)}
                    placeholder="Link (optional) — e.g. linear.app"
                    maxLength={500}
                    className={WARM_INPUT}
                  />
                  <select
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value)}
                    className="ctm-sel"
                    aria-label="Custom tool category"
                  >
                    <option value="">Category</option>
                    {CODING_TOOL_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addCustom}
                  disabled={!customName.trim()}
                  className="self-start border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                >
                  <Plus className="h-4 w-4" /> Add to selection
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="ctm-foot">
          <div className="ctm-count">
            {count ? (
              <>
                <b>{count}</b> tool{count > 1 ? "s" : ""} selected
              </>
            ) : (
              "Nothing selected yet"
            )}
          </div>
          <div className="acts">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              className="border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={submit}
              disabled={isPending || count === 0}
              className="bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)]"
            >
              {isPending ? (
                "Adding…"
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  {count ? `Add ${count} tool${count > 1 ? "s" : ""}` : "Add tools"}
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
