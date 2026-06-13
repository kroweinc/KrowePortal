import type { RepoContext } from "@/lib/github/types";
import type { ProjectProfile } from "@/lib/actions/generate-project-profile";

export type ArchLayerRole = "Frontend" | "Auth" | "Data" | "Backend";

export type ArchLayer = {
  role: ArchLayerRole;
  icon: "code" | "cloud" | "db" | "branch";
  accent: string;
  items: string[];
};

const ROLE_META: Record<ArchLayerRole, { icon: ArchLayer["icon"]; accent: string }> = {
  Frontend: { icon: "code", accent: "#3178c6" },
  Auth: { icon: "cloud", accent: "#f97316" },
  Data: { icon: "db", accent: "#15803d" },
  Backend: { icon: "branch", accent: "#6d28d9" },
};

const KEYWORDS: Record<ArchLayerRole, RegExp> = {
  Frontend: /\b(next\.?js|react|vue|svelte|nuxt|angular|tailwind|astro|remix|vite|webpack|app router|app\/|components\/|pages\/|tsx|typescript|javascript|css)\b/i,
  Auth: /\b(clerk|auth0|cognito|amplify|next-?auth|firebase auth|kinde|workos|magic\.?link|oauth|sso|session|jwt)\b/i,
  Data: /\b(supabase|postgres|postgresql|plpgsql|mysql|mongo|mongodb|redis|prisma|drizzle|knex|sql|sqlite|firestore|dynamodb|s3|storage|row-?level)\b/i,
  Backend: /\b(api\/|api routes|trpc|graphql|express|fastify|hono|cloudflare workers?|lambda|cron|queue|stripe|webhook|docker(file)?)\b/i,
};

function classify(token: string): ArchLayerRole | null {
  for (const role of Object.keys(KEYWORDS) as ArchLayerRole[]) {
    if (KEYWORDS[role].test(token)) return role;
  }
  return null;
}

// Tech identities that can surface both as a service name and as a config file
// (e.g. "amplify" and "amplify.yml"). Both forms collapse to one display name
// so the same technology is never listed twice within a layer.
const CANONICAL: { match: RegExp; name: string }[] = [
  { match: /amplify/i, name: "AWS Amplify" },
];

function pretty(token: string): string {
  const cleaned = token.replace(/\/$/, "").trim();
  for (const { match, name } of CANONICAL) {
    if (match.test(cleaned)) return name;
  }
  // Capitalize known tech names
  const map: Record<string, string> = {
    "next.js": "Next.js",
    nextjs: "Next.js",
    react: "React",
    typescript: "TypeScript",
    tailwind: "Tailwind CSS",
    supabase: "Supabase",
    postgres: "Postgres",
    postgresql: "Postgres",
    plpgsql: "PLpgSQL",
    "row-level": "Row-level security",
    cognito: "Cognito",
    clerk: "Clerk",
    auth0: "Auth0",
    "next-auth": "NextAuth",
    "next.config.mjs": "Next.js",
    middleware: "middleware.ts",
    dockerfile: "Dockerfile",
  };
  return map[cleaned.toLowerCase()] ?? cleaned;
}

export function deriveArchLayers(
  ctx: RepoContext,
  profile: ProjectProfile | null
): ArchLayer[] {
  const buckets: Record<ArchLayerRole, Set<string>> = {
    Frontend: new Set(),
    Auth: new Set(),
    Data: new Set(),
    Backend: new Set(),
  };

  // Languages always weigh in on Frontend / Backend
  for (const lang of ctx.languages) {
    const role = classify(lang.name);
    if (role) buckets[role].add(pretty(lang.name));
  }

  // Top-level tree entries — keyword match
  for (const entry of ctx.topLevelTree) {
    const role = classify(entry);
    if (role) buckets[role].add(pretty(entry));
  }

  // Services from AI profile
  if (profile) {
    for (const svc of profile.services) {
      const role = classify(svc.name) ?? classify(svc.purpose);
      if (role) buckets[role].add(pretty(svc.name));
    }
  }

  // Order: Frontend → Auth → Data → Backend
  const order: ArchLayerRole[] = ["Frontend", "Auth", "Data", "Backend"];
  const layers: ArchLayer[] = [];
  for (const role of order) {
    const items = Array.from(buckets[role]).slice(0, 6);
    if (items.length === 0) continue;
    layers.push({ role, ...ROLE_META[role], items });
  }
  return layers;
}
