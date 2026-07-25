/**
 * Brand hues for the Repo page's language legend and tech chips.
 *
 * Values for the languages the design shows are lifted from the Figma frame;
 * the rest follow GitHub Linguist. Everything renders at 10% as a chip
 * background with the full hue as text, so these need to hold contrast on a
 * near-white surface — the fallback palette is picked with that in mind.
 */

const LANGUAGE_COLORS: Record<string, string> = {
  typescript: "#2e70d1",
  css: "#e059ed",
  javascript: "#f5c430",
  plpgsql: "#40bf8c",
  mdx: "#fa7317",
  html: "#e34c26",
  scss: "#c6538c",
  sass: "#c6538c",
  python: "#3572a5",
  go: "#00add8",
  rust: "#c56a30",
  ruby: "#9c2027",
  java: "#b07219",
  php: "#4f5d95",
  shell: "#4f9e3b",
  dockerfile: "#384d54",
  sql: "#e38c00",
  swift: "#f05138",
  kotlin: "#8b5cf6",
  "c#": "#178600",
  "c++": "#f34b7d",
  c: "#555555",
  vue: "#41b883",
  svelte: "#ff3e00",
  markdown: "#66788a",
  json: "#857568",
  yaml: "#cb171e",
};

// Used when a language isn't in the table. Deterministic per name so a repo's
// legend keeps the same colors between renders.
const FALLBACK_HUES = [
  "#2e70d1",
  "#e059ed",
  "#f5c430",
  "#40bf8c",
  "#fa7317",
  "#8b5cf6",
  "#0081a3",
];

function hueFor(name: string): string {
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
  return FALLBACK_HUES[sum % FALLBACK_HUES.length];
}

export function languageColor(name: string): string {
  return LANGUAGE_COLORS[name.toLowerCase()] ?? hueFor(name);
}

/**
 * Tech chips inside the Toolkit layer cards. Tools whose brand mark is simply
 * black (Next.js, Vercel, Framer, OpenAI) resolve to --foreground so they read
 * as warm ink rather than a hard #000 the palette doesn't contain.
 */
const TECH_COLORS: Record<string, string> = {
  react: "#0081a3",
  "tailwind css": "#0ea5e9",
  tailwind: "#0ea5e9",
  supabase: "#249361",
  postgres: "#336791",
  postgresql: "#336791",
  typescript: "#2e70d1",
  stripe: "#635bff",
  clerk: "#6c47ff",
  auth0: "#eb5424",
  firebase: "#f5820b",
  redis: "#d82c20",
  prisma: "#0c344b",
  graphql: "#e10098",
  docker: "#2496ed",
  "aws amplify": "#ff9900",
  sanity: "#f03e2f",
  resend: "#0081a3",
};

export function techColor(name: string): string {
  return TECH_COLORS[name.toLowerCase()] ?? "var(--foreground)";
}
