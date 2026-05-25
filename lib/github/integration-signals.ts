import { readFileContent, searchCode } from "./file-content";
import { GitHubError, RateLimitError } from "./types";
import type { RepoToolContext } from "./ai-tools";
import type { RepoContext } from "./types";

export type IntegrationSignals = {
  envVars: { name: string; path: string }[];
  hostnames: { host: string; url: string; path: string }[];
  filesRead: string[];
  searchesRun: string[];
  searchErrors: string[];
};

// Patterns for env-var REFERENCES in source code (process.env.FOO, etc.)
const ENV_REF_PATTERNS: RegExp[] = [
  /process\.env(?:\.|\[\s*["'`])([A-Z][A-Z0-9_]{3,})["'`]?\s*\]?/g,
  /os\.environ(?:\.get\()?\s*\[?\s*["'`]([A-Z][A-Z0-9_]{3,})["'`]/g,
  /Deno\.env\.get\(\s*["'`]([A-Z][A-Z0-9_]{3,})["'`]/g,
  /ENV\s*\[\s*["'`]([A-Z][A-Z0-9_]{3,})["'`]\s*\]/g,
  /import\.meta\.env\.([A-Z][A-Z0-9_]{3,})/g,
];

// Pattern for env-var DECLARATIONS in .env-style files (KEY=value at line start)
const ENV_DECL_PATTERN = /^([A-Z][A-Z0-9_]{3,})\s*=/gm;

// Skip generic / infra env vars that don't map to a vendor.
const IGNORED_ENV_VARS = new Set([
  "NODE_ENV",
  "PORT",
  "HOST",
  "PATH",
  "HOME",
  "USER",
  "PWD",
  "API_KEY",
  "API_URL",
  "BASE_URL",
  "PUBLIC_URL",
  "NEXT_RUNTIME",
  "NEXT_PUBLIC_BASE_URL",
  "NEXT_PUBLIC_VERCEL_URL",
  "VERCEL_URL",
  "VERCEL_ENV",
  "VERCEL_REGION",
  "DATABASE_URL",
  "DB_URL",
  "DB_HOST",
  "DB_PORT",
  "DB_NAME",
  "DB_USER",
  "DB_PASSWORD",
  "SECRET_KEY",
  "JWT_SECRET",
  "SESSION_SECRET",
  "ENCRYPTION_KEY",
  "AUTH_SECRET",
  "NEXTAUTH_SECRET",
  "NEXTAUTH_URL",
]);

const HOSTNAME_PATTERN = /https?:\/\/([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(?:[\/"' )]|$)/g;

const IGNORED_HOSTNAMES = new Set([
  "github.com",
  "www.github.com",
  "raw.githubusercontent.com",
  "localhost",
  "127.0.0.1",
  "example.com",
  "www.example.com",
  "vercel.app",
  "www.w3.org",
  "schema.org",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "tailwindcss.com",
  "nextjs.org",
  "reactjs.org",
  "developer.mozilla.org",
]);

function isLikelyVendorHostname(host: string): boolean {
  const lower = host.toLowerCase();
  if (IGNORED_HOSTNAMES.has(lower)) return false;
  if (lower.startsWith("api.")) return true;
  if (lower.includes(".api.")) return true;
  if (/^(api\d+|api-\w+)\./.test(lower)) return true;
  // Vendor-shaped subdomain prefixes that are commonly external APIs.
  if (/^(graphql|gql|rest|webhook|ws|stream|events)\./.test(lower)) return true;
  return false;
}

function extractEnvRefs(content: string): string[] {
  const found = new Set<string>();
  for (const pattern of ENV_REF_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const name = match[1];
      if (!IGNORED_ENV_VARS.has(name)) found.add(name);
    }
  }
  return [...found];
}

function extractEnvDecls(content: string): string[] {
  const found = new Set<string>();
  ENV_DECL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ENV_DECL_PATTERN.exec(content)) !== null) {
    const name = match[1];
    if (!IGNORED_ENV_VARS.has(name)) found.add(name);
  }
  return [...found];
}

function extractHostnames(content: string): { host: string; url: string }[] {
  const found = new Map<string, string>();
  HOSTNAME_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HOSTNAME_PATTERN.exec(content)) !== null) {
    const host = match[1].toLowerCase();
    const url = match[0].replace(/[\/"' )]$/, "");
    if (isLikelyVendorHostname(host) && !found.has(host)) {
      found.set(host, url);
    }
  }
  return [...found.entries()].map(([host, url]) => ({ host, url }));
}

const MANIFEST_BASENAMES = new Set([
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "setup.py",
  "Pipfile",
  "go.mod",
  "Cargo.toml",
  "Gemfile",
  "composer.json",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
]);

// Common env-file locations to attempt even if not in the manifest (.env* is often gitignored).
const COMMON_ENV_PATHS = [
  ".env.example",
  ".env.sample",
  ".env.local.example",
  ".env.example.local",
  ".env.development",
  ".env.production",
  ".env.template",
  ".env.dist",
  "env.example",
];

const SOURCE_EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb|php|java|kt|rs|svelte|vue|astro)$/i;

const SOURCE_FOLDER_HINTS = [
  /(^|\/)api(\/|$)/i,
  /(^|\/)apis(\/|$)/i,
  /(^|\/)services?(\/|$)/i,
  /(^|\/)integrations?(\/|$)/i,
  /(^|\/)clients?(\/|$)/i,
  /(^|\/)providers?(\/|$)/i,
  /(^|\/)server(\/|$)/i,
  /(^|\/)backend(\/|$)/i,
];

const SOURCE_BASENAME_HINTS = [
  /-?client\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb)$/i,
  /-?service\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb)$/i,
  /-?api\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb)$/i,
  /-?provider\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb)$/i,
  /route\.(ts|tsx|js|jsx|mjs|cjs)$/i,
];

function pickHighSignalFiles(manifest: string[]): string[] {
  const out = new Set<string>();

  const manifestFiles = manifest.filter((p) => {
    const base = p.split("/").pop() ?? p;
    return MANIFEST_BASENAMES.has(base);
  });
  manifestFiles.slice(0, 4).forEach((f) => out.add(f));

  const envFiles = manifest.filter((p) => {
    const base = p.split("/").pop() ?? p;
    return /^\.?env([.-]|$)/i.test(base) && !/\.local$/i.test(base);
  });
  envFiles.slice(0, 5).forEach((f) => out.add(f));

  const sourceFiles = manifest.filter((p) => {
    if (!SOURCE_EXT_RE.test(p)) return false;
    if (SOURCE_FOLDER_HINTS.some((rx) => rx.test(p))) return true;
    const base = p.split("/").pop() ?? p;
    return SOURCE_BASENAME_HINTS.some((rx) => rx.test(base));
  });
  sourceFiles.slice(0, 12).forEach((f) => out.add(f));

  return [...out];
}

const SEARCH_FALLBACK_QUERIES = ['"process.env"', '"https://api"', '"_API_KEY"'];

export async function discoverIntegrationSignals(
  ctx: RepoContext,
  toolContext: RepoToolContext
): Promise<IntegrationSignals> {
  const envVars = new Map<string, string>();
  const hostnames = new Map<string, { url: string; path: string }>();
  const filesRead: string[] = [];
  const searchesRun: string[] = [];
  const searchErrors: string[] = [];

  // 1. Read high-signal files from the manifest (manifests, env files, API/service folders).
  const manifestDriven = pickHighSignalFiles(ctx.fileManifest);

  // 2. Also try common env paths that may be gitignored but checked into the repo.
  const knownPaths = new Set(manifestDriven);
  const envFallbacks = COMMON_ENV_PATHS.filter((p) => !knownPaths.has(p));

  const allPaths = [...manifestDriven, ...envFallbacks];

  const reads = await Promise.allSettled(
    allPaths.map((path) =>
      readFileContent(toolContext.token, toolContext.owner, toolContext.repo, toolContext.ref, path)
    )
  );

  for (let i = 0; i < reads.length; i++) {
    const path = allPaths[i];
    const settled = reads[i];
    if (settled.status !== "fulfilled") continue;
    const result = settled.value;
    if (!result.ok) continue;
    filesRead.push(path);

    const base = path.split("/").pop() ?? path;
    const isEnvFile = /^\.?env([.-]|$)/i.test(base);

    const envNames = isEnvFile
      ? [...extractEnvDecls(result.content), ...extractEnvRefs(result.content)]
      : extractEnvRefs(result.content);

    for (const name of envNames) {
      if (!envVars.has(name)) envVars.set(name, path);
    }
    for (const { host, url } of extractHostnames(result.content)) {
      if (!hostnames.has(host)) hostnames.set(host, { url, path });
    }
  }

  // 3. Supplement with code search (cheap when it works, harmless when it doesn't).
  await Promise.all(
    SEARCH_FALLBACK_QUERIES.map(async (query) => {
      try {
        const result = await searchCode(toolContext.token, toolContext.owner, toolContext.repo, query);
        searchesRun.push(`${query} → ${result.results.length} hits`);
        for (const item of result.results) {
          for (const name of extractEnvRefs(item.fragment)) {
            if (!envVars.has(name)) envVars.set(name, item.path);
          }
          for (const { host, url } of extractHostnames(item.fragment)) {
            if (!hostnames.has(host)) hostnames.set(host, { url, path: item.path });
          }
        }
      } catch (err) {
        if (err instanceof RateLimitError) searchErrors.push(`${query}: rate limit`);
        else if (err instanceof GitHubError) searchErrors.push(`${query}: gh ${err.status}`);
        else {
          const msg = err instanceof Error ? err.message : String(err);
          searchErrors.push(`${query}: ${msg}`);
        }
      }
    })
  );

  return {
    envVars: [...envVars.entries()]
      .slice(0, 40)
      .map(([name, path]) => ({ name, path })),
    hostnames: [...hostnames.entries()]
      .slice(0, 40)
      .map(([host, info]) => ({ host, url: info.url, path: info.path })),
    filesRead,
    searchesRun,
    searchErrors,
  };
}
