// Derives achievement/identity tags from the rest of a builder's profile so
// badges "auto-add" without manual entry. Pure and deterministic — no AI, no
// I/O — so it can run on every read of both the editor bundle and the public
// page. Output is always a subset of BUILDER_TAG_PRESETS, keeping derived tags
// visually identical to ones a builder picks by hand.
//
// Rules favor precision over recall: a wrong badge erodes trust more than a
// missing one, so each rule looks for a strong, specific signal.

import { BUILDER_TAG_PRESETS } from "@/lib/types";

export interface DeriveTagsInput {
  headline: string | null;
  bio: string | null;
  educationSchool: string | null;
  educationMajor: string | null;
  educationYear: string | null;
  experience: { role: string; company: string; description: string | null }[];
  projects: {
    source: string;
    tech: string[] | null;
    stars: number | null;
    commit_count: number | null;
    languages: { name: string; pct: number }[] | null;
    live_url: string | null;
    github_is_private: boolean | null;
  }[];
  codingTools: { name: string; category: string | null }[];
}

// At most this many derived tags, so a rich profile doesn't flood the badge row.
const MAX_DERIVED = 8;

// Exact-token tech signals. Compared case-insensitively against project tech,
// GitHub language names, and coding-tool names — never substring-matched, so
// "go" can't fire on "good" and "ai" can't fire on "email".
const FRONTEND_TECH = new Set([
  "react", "react native", "next", "next.js", "nextjs", "vue", "vue.js",
  "angular", "svelte", "sveltekit", "tailwind", "tailwindcss", "html", "css",
  "scss", "sass", "redux",
]);

const BACKEND_TECH = new Set([
  "node", "node.js", "nodejs", "express", "django", "flask", "fastapi",
  "rails", "ruby on rails", "spring", "spring boot", "laravel", "postgres",
  "postgresql", "mysql", "mongodb", "sqlite", "redis", "graphql", "prisma",
  "go", "golang", "rust", "java", "c#", ".net", "php", "supabase", "firebase",
]);

const AI_TECH = new Set([
  "pytorch", "tensorflow", "keras", "scikit-learn", "sklearn", "hugging face",
  "huggingface", "transformers", "openai", "langchain", "llamaindex", "llm",
  "nlp", "opencv", "cuda", "stable diffusion",
]);

export function deriveProfileTags(input: DeriveTagsInput): string[] {
  // Free text for natural-language phrase matching (headline, bio, roles).
  const freeText = [
    input.headline,
    input.bio,
    ...input.experience.flatMap((e) => [e.role, e.company, e.description]),
  ]
    .filter(Boolean)
    .join(" \n ")
    .toLowerCase();

  // Exact, lowercased tech tokens from structured fields.
  const techTokens = new Set<string>();
  for (const p of input.projects) {
    for (const t of p.tech ?? []) techTokens.add(t.toLowerCase().trim());
    for (const l of p.languages ?? []) techTokens.add(l.name.toLowerCase().trim());
  }
  for (const tool of input.codingTools) techTokens.add(tool.name.toLowerCase().trim());

  const hasText = (re: RegExp) => re.test(freeText);
  const hasTech = (set: Set<string>) => {
    for (const t of techTokens) if (set.has(t)) return true;
    return false;
  };

  const major = (input.educationMajor ?? "").toLowerCase();
  const school = (input.educationSchool ?? "").toLowerCase();
  const year = (input.educationYear ?? "").toLowerCase();

  const hasFrontend = hasTech(FRONTEND_TECH) || hasText(/\bfront[\s-]?end\b/);
  const hasBackend = hasTech(BACKEND_TECH) || hasText(/\bback[\s-]?end\b/);
  const hasAi =
    hasTech(AI_TECH) ||
    hasText(
      /\b(machine learning|deep learning|neural network|computer vision|natural language processing|nlp|llms?|generative ai|ai\/ml|ml engineer|ai engineer|data scien)\b/
    );

  const isCoFounder = hasText(/\bco[\s-]?founder\b/);
  const isTechnical = hasText(/\b(cto|technical|engineer|developer|software|programmer)\b/);

  const out: string[] = [];
  const add = (tag: (typeof BUILDER_TAG_PRESETS)[number]) => {
    if (!out.includes(tag)) out.push(tag);
  };

  // Founder identity — prefer the more specific badge when it applies.
  if (isCoFounder && isTechnical) {
    add("Technical Co-Founder");
  } else if (hasText(/\b(founder|co[\s-]?founder|ceo)\b|\bfounded\b/)) {
    add("Startup Founder");
  }

  if (hasText(/\by[\s-]?combinator\b|\byc\s*[swf]?\d{2}\b|\(yc\b/)) add("Y Combinator Alum");

  if (hasText(/\b(indie hacker|bootstrapp(ed|ing)|solo founder|solopreneur|building in public)\b/))
    add("Indie Hacker");

  // Hackathon win needs both the event and a win signal somewhere in the text.
  if (hasText(/hackathon/) && hasText(/\b(won|winner|win|1st|first place|champion|grand prize|finalist)\b/))
    add("Hackathon Winner");

  // Open source: a public repo with real traction, or an explicit mention.
  const openSourceRepo = input.projects.some(
    (p) =>
      p.source === "github" &&
      p.github_is_private === false &&
      ((p.stars ?? 0) >= 5 || (p.commit_count ?? 0) >= 100)
  );
  if (openSourceRepo || hasText(/\bopen[\s-]?source\b|\bmaintainer\b/)) add("Open Source Contributor");

  if (hasAi) add("AI / ML Engineer");

  if (hasFrontend && hasBackend) add("Full-Stack Developer");
  else if (hasText(/\bfull[\s-]?stack\b/)) add("Full-Stack Developer");

  // A deployed/live link is strong evidence something actually shipped.
  if (input.projects.some((p) => !!p.live_url?.trim()) || hasText(/\b(shipped|launched|in production)\b/))
    add("Shipped a Product");

  if (hasText(/\b(spoke at|keynote|gave a talk|presented at|conference speaker|tech talk|tedx)\b/))
    add("Conference Speaker");

  if (hasText(/\b(published author|author of|wrote a book|published a book|co[\s-]?authored|o'reilly)\b/))
    add("Published Author");

  if (hasText(/\b(freelance|freelancer|contractor|consultant|self[\s-]?employed)\b/))
    add("Freelance Developer");

  if (hasText(/\bself[\s-]?taught\b/)) add("Self-Taught Developer");

  // Bootcamp: a well-known program name, or the word itself in school/text.
  const BOOTCAMPS =
    /\b(bootcamp|app academy|hack reactor|general assembly|flatiron|lambda school|bloomtech|le wagon|codesmith|fullstack academy|springboard|nucamp)\b/;
  if (BOOTCAMPS.test(school) || hasText(BOOTCAMPS)) add("Bootcamp Grad");

  // CS Student: a computing major at a named school. Year hints at "in progress"
  // strengthen it but aren't required.
  const csMajor = /\b(computer science|comp sci|cs|software engineering|computer engineering|information technology|informatics)\b/.test(
    major
  );
  const looksCurrent = year === "" || /class of|present|current|expected/.test(year);
  if (school && csMajor && looksCurrent) add("CS Student");

  return out.slice(0, MAX_DERIVED);
}
