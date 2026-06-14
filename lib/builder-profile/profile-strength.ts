// Profile-strength model — a weighted checklist of what makes a builder profile
// "client-ready". Pure and deterministic so the sticky header ring/bar, the
// chip ticks, and the live preview can all read the same number from the draft.
// Ported from the Smart Scroll design prototype (profile-data.js `strength()`),
// mapped onto the real draft fields.

export interface ProfileStrengthInput {
  displayName: string;
  headline: string;
  bio: string;
  linkedinUrl: string;
  githubUrl: string;
  portfolioUrl: string;
  tags: string[];
  projects: { source: string }[];
  experience: unknown[];
  educationSchool: string;
  codingTools: unknown[];
  avatarUrl: string | null;
  hasResume: boolean;
}

export interface StrengthItem {
  key: string;
  label: string;
  done: boolean;
  weight: number;
}

export interface ProfileStrength {
  pct: number;
  items: StrengthItem[];
}

// Which strength item drives each section's chip tick in the sticky nav.
export const SECTION_STRENGTH_KEY: Record<string, string> = {
  basics: "name",
  tags: "tags",
  projects: "github",
  experience: "experience",
  education: "education",
  tools: "tools",
};

const has = (v: string | null | undefined) => !!(v && String(v).trim());

export function computeStrength(d: ProfileStrengthInput): ProfileStrength {
  const items: StrengthItem[] = [
    { key: "photo", label: "Add a profile photo", done: !!d.avatarUrl, weight: 8 },
    { key: "name", label: "Display name", done: has(d.displayName), weight: 6 },
    { key: "headline", label: "Write a headline", done: has(d.headline), weight: 10 },
    { key: "about", label: "Write your about", done: has(d.bio) && d.bio.trim().length > 60, weight: 14 },
    {
      key: "links",
      label: "Connect 2+ links",
      done: [d.linkedinUrl, d.githubUrl, d.portfolioUrl].filter(has).length >= 2,
      weight: 8,
    },
    { key: "tags", label: "Add 3+ tags", done: d.tags.length >= 3, weight: 8 },
    { key: "github", label: "Sync GitHub repos", done: d.projects.some((p) => p.source === "github"), weight: 12 },
    { key: "projects", label: "Show 3+ projects", done: d.projects.length >= 3, weight: 8 },
    { key: "experience", label: "Add work experience", done: d.experience.length >= 1, weight: 10 },
    { key: "resume", label: "Upload a resume", done: d.hasResume, weight: 8 },
    { key: "education", label: "Add education", done: has(d.educationSchool), weight: 4 },
    { key: "tools", label: "List your coding tools", done: d.codingTools.length >= 3, weight: 4 },
  ];
  const total = items.reduce((s, i) => s + i.weight, 0);
  const got = items.reduce((s, i) => s + (i.done ? i.weight : 0), 0);
  return { pct: Math.round((got / total) * 100), items };
}
