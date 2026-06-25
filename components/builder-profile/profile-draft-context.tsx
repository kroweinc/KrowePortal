"use client";

// Shared client store for the Profile Setup screen. Seeds from the server
// `bundle`, then becomes the single source of truth for everything live: the
// section forms, the strength meter, the chip ticks, and the side "Live
// preview" drawer all read from here.
//
// Two save paths:
//  • Text fields + tags autosave through the existing server actions
//    (updateProfileBasics / updateProfileTags), debounced ~700ms. The header
//    indicator reflects this ("Saving…" → "Saved" → "All changes saved").
//  • Collections (projects, experience, coding tools, avatar, resume) are still
//    edited by their own components, which persist + router.refresh(). We re-seed
//    those slices from the incoming bundle so the preview/strength stay live
//    without touching those editors.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  updateProfileBasics,
  updateProfileTags,
  type BuilderProfileBundle,
} from "@/lib/actions/builder-profile";
import { deriveProfileTags } from "@/lib/builder-profile/derive-tags";
import { githubProfileUrl } from "@/lib/project/business-context";
import type { PublicBuilderProfile } from "@/lib/actions/builder-profile-public";
import type {
  BuilderProfileCodingTool,
  BuilderProfileExperience,
  BuilderProfileProject,
} from "@/lib/types";

export type ProfileTextField =
  | "displayName"
  | "headline"
  | "bio"
  | "linkedinUrl"
  | "githubUrl"
  | "portfolioUrl"
  | "educationSchool"
  | "educationMajor"
  | "educationYear";

export interface ProfileDraft {
  // Autosaved text fields.
  displayName: string;
  headline: string;
  bio: string;
  linkedinUrl: string;
  githubUrl: string;
  portfolioUrl: string;
  educationSchool: string;
  educationMajor: string;
  educationYear: string;
  tags: string[];
  // Collections + meta — re-seeded from the bundle (preview/strength only).
  projects: BuilderProfileProject[];
  experience: BuilderProfileExperience[];
  codingTools: BuilderProfileCodingTool[];
  avatarUrl: string | null;
  hasResume: boolean;
  resumeFileName: string | null;
  githubConnected: boolean;
  githubUsername: string | null;
  githubSyncedAt: string | null;
  token: string;
  tokenExpiresAt: string | null;
  tokenRevokedAt: string | null;
  isPublished: boolean;
}

export type SaveState = "idle" | "saving" | "saved";

interface ProfileDraftContextValue {
  draft: ProfileDraft;
  /** Auto-derived achievement badges (excluding ones added by hand). Live. */
  autoTags: string[];
  saveState: SaveState;
  accountDisplayName: string;
  setField: (key: ProfileTextField, value: string) => void;
  /** Force-save URL fields on blur (server validates; toasts on error). */
  commitUrls: () => void;
  setTags: (tags: string[]) => void;
}

const ProfileDraftContext = createContext<ProfileDraftContextValue | null>(null);

export function useProfileDraft(): ProfileDraftContextValue {
  const ctx = useContext(ProfileDraftContext);
  if (!ctx) throw new Error("useProfileDraft must be used within a ProfileDraftProvider");
  return ctx;
}

// draft text key → updateProfileBasics input key, split so URL fields can be
// gated (they're strictly validated server-side and would reject mid-typing).
const PLAIN_TEXT_MAP: Record<string, string> = {
  displayName: "display_name",
  headline: "headline",
  bio: "bio",
  educationSchool: "education_school",
  educationMajor: "education_major",
  educationYear: "education_year",
};
const URL_MAP: Record<string, string> = {
  linkedinUrl: "linkedin_url",
  githubUrl: "github_url",
  portfolioUrl: "portfolio_url",
};

// Only autosave a URL mid-typing once it looks complete; otherwise wait for the
// blur flush. Empty (clearing) always saves.
function urlLooksComplete(key: string, v: string): boolean {
  if (!v) return true;
  if (key === "linkedinUrl") return /linkedin\.com\/.+/i.test(v);
  if (key === "githubUrl") return /github\.com\/.+/i.test(v);
  return /^[^\s]+\.[a-z]{2,}/i.test(v); // portfolio: host.tld …
}

function sameTags(a: string[], b: string[]) {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

function seedFromBundle(bundle: BuilderProfileBundle): ProfileDraft {
  const p = bundle.profile;
  return {
    displayName: p.display_name ?? "",
    headline: p.headline ?? "",
    bio: p.bio ?? "",
    linkedinUrl: p.linkedin_url ?? "",
    githubUrl: p.github_url ?? "",
    portfolioUrl: p.portfolio_url ?? "",
    educationSchool: p.education_school ?? "",
    educationMajor: p.education_major ?? "",
    educationYear: p.education_year ?? "",
    tags: p.tags ?? [],
    projects: bundle.projects,
    experience: bundle.experience,
    codingTools: bundle.codingTools,
    avatarUrl: bundle.avatarUrl,
    hasResume: !!p.resume_storage_path,
    resumeFileName: p.resume_file_name,
    githubConnected: bundle.githubConnected,
    githubUsername: bundle.githubUsername,
    githubSyncedAt: p.github_synced_at,
    token: p.token,
    tokenExpiresAt: p.token_expires_at,
    tokenRevokedAt: p.token_revoked_at,
    isPublished: p.is_published,
  };
}

// The snapshot the autosave engine diffs against to know what changed.
type SavedSnapshot = Pick<ProfileDraft, ProfileTextField | "tags">;
function snapshotOf(d: ProfileDraft): SavedSnapshot {
  return {
    displayName: d.displayName.trim(),
    headline: d.headline.trim(),
    bio: d.bio.trim(),
    linkedinUrl: d.linkedinUrl.trim(),
    githubUrl: d.githubUrl.trim(),
    portfolioUrl: d.portfolioUrl.trim(),
    educationSchool: d.educationSchool.trim(),
    educationMajor: d.educationMajor.trim(),
    educationYear: d.educationYear.trim(),
    tags: [...d.tags],
  };
}

export function ProfileDraftProvider({
  bundle,
  accountDisplayName,
  children,
}: {
  bundle: BuilderProfileBundle;
  accountDisplayName: string;
  children: React.ReactNode;
}) {
  const [draft, setDraft] = useState<ProfileDraft>(() => seedFromBundle(bundle));
  const [saveState, setSaveState] = useState<SaveState>("idle");

  // Latest draft for the debounced saver to read without stale closures.
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const savedRef = useRef<SavedSnapshot>(snapshotOf(draft));
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inFlight = useRef(false);
  const rerun = useRef(false);

  const markSaved = useCallback(() => {
    setSaveState("saved");
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setSaveState("idle"), 2500);
  }, []);

  const runSave = useCallback(
    async (flushUrls: boolean) => {
      if (inFlight.current) {
        rerun.current = true;
        return;
      }
      const d = draftRef.current;
      const saved = savedRef.current;

      const payload: Record<string, string | null> = {};
      const includedKeys: ProfileTextField[] = [];
      for (const [k, col] of Object.entries(PLAIN_TEXT_MAP)) {
        const key = k as ProfileTextField;
        if (d[key].trim() !== saved[key]) {
          payload[col] = d[key].trim();
          includedKeys.push(key);
        }
      }
      for (const [k, col] of Object.entries(URL_MAP)) {
        const key = k as ProfileTextField;
        const v = d[key].trim();
        if (v === saved[key]) continue;
        if (v === "" || flushUrls || urlLooksComplete(key, v)) {
          payload[col] = v || null;
          includedKeys.push(key);
        }
      }
      const tagsChanged = !sameTags(d.tags, saved.tags);

      if (includedKeys.length === 0 && !tagsChanged) return;

      inFlight.current = true;
      setSaveState("saving");
      let ok = true;

      if (includedKeys.length > 0) {
        const r = await updateProfileBasics(payload);
        if (r.error) {
          ok = false;
          toast.error(r.error);
        } else {
          for (const key of includedKeys) savedRef.current[key] = d[key].trim();
        }
      }
      if (tagsChanged) {
        const r = await updateProfileTags({ tags: d.tags });
        if (r.error) {
          ok = false;
          toast.error(r.error);
        } else {
          savedRef.current.tags = [...d.tags];
        }
      }

      inFlight.current = false;
      if (ok) markSaved();
      else setSaveState("idle");

      // A change that landed while we were saving — pick it up now.
      if (rerun.current) {
        rerun.current = false;
        void runSave(false);
      }
    },
    [markSaved]
  );

  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void runSave(false), 700);
  }, [runSave]);

  const setField = useCallback(
    (key: ProfileTextField, value: string) => {
      setDraft((d) => ({ ...d, [key]: value }));
      scheduleSave();
    },
    [scheduleSave]
  );

  const setTags = useCallback(
    (tags: string[]) => {
      setDraft((d) => ({ ...d, tags }));
      scheduleSave();
    },
    [scheduleSave]
  );

  const commitUrls = useCallback(() => {
    // Normalize a bare GitHub handle to a full URL before the flush so the
    // server accepts it (mirrors BasicsForm's old onBlur).
    setDraft((d) => {
      const gh = d.githubUrl.trim();
      const next = gh ? githubProfileUrl(gh) || gh : gh;
      return next === d.githubUrl ? d : { ...d, githubUrl: next };
    });
    clearTimeout(saveTimer.current);
    // Defer so the normalized value is in draftRef before we read it.
    setTimeout(() => void runSave(true), 0);
  }, [runSave]);

  // Re-seed from a fresh server bundle (after a collection editor's
  // router.refresh(), or a portfolio import). Collections + meta always adopt
  // the server. Text/tags merge: a field adopts the server value only when the
  // user has no unsaved edit to it (draft === last-saved), so server-driven
  // changes (import "Fill from it") flow in while in-flight typing is never
  // clobbered.
  useEffect(() => {
    const d = draftRef.current;
    const saved = savedRef.current;
    const p = bundle.profile;
    const serverText: Record<ProfileTextField, string> = {
      displayName: p.display_name ?? "",
      headline: p.headline ?? "",
      bio: p.bio ?? "",
      linkedinUrl: p.linkedin_url ?? "",
      githubUrl: p.github_url ?? "",
      portfolioUrl: p.portfolio_url ?? "",
      educationSchool: p.education_school ?? "",
      educationMajor: p.education_major ?? "",
      educationYear: p.education_year ?? "",
    };

    const patch: Partial<ProfileDraft> = {
      projects: bundle.projects,
      experience: bundle.experience,
      codingTools: bundle.codingTools,
      avatarUrl: bundle.avatarUrl,
      hasResume: !!p.resume_storage_path,
      resumeFileName: p.resume_file_name,
      githubConnected: bundle.githubConnected,
      githubUsername: bundle.githubUsername,
      githubSyncedAt: p.github_synced_at,
      token: p.token,
      tokenExpiresAt: p.token_expires_at,
      tokenRevokedAt: p.token_revoked_at,
      isPublished: p.is_published,
    };

    for (const key of Object.keys(serverText) as ProfileTextField[]) {
      if (d[key].trim() === saved[key] && serverText[key].trim() !== saved[key]) {
        patch[key] = serverText[key];
        savedRef.current[key] = serverText[key].trim();
      }
    }
    const serverTags = p.tags ?? [];
    if (sameTags(d.tags, saved.tags) && !sameTags(serverTags, saved.tags)) {
      patch.tags = serverTags;
      savedRef.current.tags = [...serverTags];
    }

    setDraft((prev) => ({ ...prev, ...patch }));
  }, [bundle]);

  useEffect(() => {
    return () => {
      clearTimeout(saveTimer.current);
      clearTimeout(idleTimer.current);
    };
  }, []);

  const autoTags = useMemo(() => {
    const manual = new Set(draft.tags.map((t) => t.toLowerCase()));
    return deriveProfileTags({
      headline: draft.headline || null,
      bio: draft.bio || null,
      educationSchool: draft.educationSchool || null,
      educationMajor: draft.educationMajor || null,
      educationYear: draft.educationYear || null,
      experience: draft.experience.map((e) => ({
        role: e.role,
        company: e.company,
        description: e.description,
      })),
      projects: draft.projects.map((p) => ({
        source: p.source,
        tech: p.tech,
        stars: p.stars,
        commit_count: p.commit_count,
        languages: p.languages,
        live_url: p.live_url,
        github_is_private: p.github_is_private,
      })),
      codingTools: draft.codingTools.map((t) => ({ name: t.name, category: t.category })),
    }).filter((t) => !manual.has(t.toLowerCase()));
  }, [
    draft.headline,
    draft.bio,
    draft.educationSchool,
    draft.educationMajor,
    draft.educationYear,
    draft.experience,
    draft.projects,
    draft.codingTools,
    draft.tags,
  ]);

  const value = useMemo<ProfileDraftContextValue>(
    () => ({ draft, autoTags, saveState, accountDisplayName, setField, commitUrls, setTags }),
    [draft, autoTags, saveState, accountDisplayName, setField, commitUrls, setTags]
  );

  return <ProfileDraftContext.Provider value={value}>{children}</ProfileDraftContext.Provider>;
}

// Maps the live draft into the exact PublicBuilderProfile shape the public page
// (and the preview drawer) render, so the mirror can never drift from the real
// thing. Only the builder's added tags show — recommendations stay in the editor.
export function draftToPublicProfile(
  draft: ProfileDraft,
  accountDisplayName: string
): PublicBuilderProfile {
  const tags = draft.tags.slice(0, 14);
  return {
    displayName: draft.displayName.trim() || accountDisplayName || "Builder",
    headline: draft.headline.trim() || null,
    bio: draft.bio.trim() || null,
    linkedinUrl: draft.linkedinUrl.trim() || null,
    githubUrl: draft.githubUrl.trim() || null,
    portfolioUrl: draft.portfolioUrl.trim() || null,
    educationSchool: draft.educationSchool.trim() || null,
    educationMajor: draft.educationMajor.trim() || null,
    educationYear: draft.educationYear.trim() || null,
    tags,
    avatarUrl: draft.avatarUrl,
    hasResume: draft.hasResume,
    githubUsername: draft.githubUsername,
    githubSyncedAt: draft.githubSyncedAt,
    // Tech badges render as plain text pills in the live preview: brand-glyph
    // resolution is server-only (keeps `simple-icons` out of the client bundle),
    // and the draft is live client state with no server round-trip. The published
    // public page resolves the real brand logos server-side.
    projects: draft.projects.map((project) => ({
      ...project,
      techBadges: project.tech.map((tech) => ({ tech, icon: null })),
    })),
    experience: draft.experience,
    codingTools: draft.codingTools,
  };
}
