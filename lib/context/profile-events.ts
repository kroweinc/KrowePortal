import "server-only";

import { createAdminClient } from "@/lib/supabase/server";

// ============================================================
// Record an immutable change-log entry every time a person's profile mirror
// (builder profile / operator business) actually changes — the history surfaced
// on the builder/operator nodes in the Context graph ("what changed, and from
// what"). Fed from sync-profile.ts at the exact moment the serialized mirror is
// updated, where both the old and new text are in hand.
//
// Like recordDocumentEvent, everything here is BEST-EFFORT: an audit write must
// never break the profile sync, so failures are logged and swallowed. Writes go
// through the service-role admin client (bypasses RLS); the calling sync path
// has already proven engagement ownership.
// ============================================================

export type ProfileRole = "builder" | "operator";

// One section's worth of change within a single profile update: the lines that
// went away (the "from") and the lines that appeared (the "to") under one
// section heading, e.g. field "Headline", removed ["Old headline"], added
// ["New headline"].
export interface ProfileFieldChange {
  field: string;
  removed: string[];
  added: string[];
}

// Parse a serialized profile (see serialize-profile.ts) into section → content
// lines. Sections are the `## Label` headings emitted by the Lines helper; the
// leading `# … — Name` title maps to a synthetic "Name" section so a rename is
// tracked like any other field.
function parseSections(text: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const title = line.match(/^#\s+.*?—\s*(.+)$/);
    if (title) {
      sections.set("Name", [title[1].trim()]);
      current = "";
      continue;
    }
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      current = heading[1].trim();
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    if (!current) continue; // stray content before any section — ignore
    sections.get(current)!.push(line);
  }
  return sections;
}

// Field-level diff between two serialized profiles: per section, the lines
// removed (from) and added (to). Returns [] when nothing substantive changed.
// Section order follows the new text, with removed-only sections appended.
export function diffProfileText(oldText: string, newText: string): ProfileFieldChange[] {
  const before = parseSections(oldText);
  const after = parseSections(newText);
  const changes: ProfileFieldChange[] = [];
  const seen = new Set<string>();

  const consider = (field: string) => {
    if (seen.has(field)) return;
    seen.add(field);
    const oldLines = before.get(field) ?? [];
    const newLines = after.get(field) ?? [];
    const oldSet = new Set(oldLines);
    const newSet = new Set(newLines);
    const removed = oldLines.filter((l) => !newSet.has(l));
    const added = newLines.filter((l) => !oldSet.has(l));
    if (removed.length || added.length) changes.push({ field, removed, added });
  };

  for (const field of after.keys()) consider(field);
  for (const field of before.keys()) consider(field);
  return changes;
}

export interface RecordProfileEventInput {
  engagementId: string;
  role: ProfileRole;
  actorId?: string | null;
  changes: ProfileFieldChange[];
}

/** Append one immutable profile-update event. No-ops when there's no change. */
export async function recordProfileEvent(input: RecordProfileEventInput): Promise<void> {
  if (!input.changes.length) return;
  try {
    const admin = createAdminClient();
    await admin.from("profile_events").insert({
      engagement_id: input.engagementId,
      role: input.role,
      actor_id: input.actorId ?? null,
      payload: { changes: input.changes },
    });
  } catch (err) {
    console.error("[recordProfileEvent]", err);
  }
}
