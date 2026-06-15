"use client";

/* Brand logo shown to the LEFT of each Tech Stack (§9) and 3rd-Party Software
   (§8) item. The logo is resolved from a website host, in priority order:
     1. the item's saved `domain` (filled by the AI lookup / generation), then
     2. a built-in directory of common dev tools & SaaS (KNOWN_DOMAINS) keyed off
        the item's name — so logos appear instantly even for PRDs created before
        domains were saved, with no AI call and no API key.
   The host is turned into an image URL via Google's zero-config favicon service
   (default), or Brandfetch's logo CDN if NEXT_PUBLIC_BRANDFETCH_CLIENT_ID is set.
   When nothing resolves, or the image fails to load, we fall back to a neutral
   monogram tile so the row's alignment stays consistent. */

import { useEffect, useState } from "react";
import { assetUrl } from "@/lib/asset-url";

/** Built-in name → official-website-host directory for the common stack/SaaS
    choices. Keys are lowercase; matching is done against the normalized name and
    its tokens (below), so "Next.js", "nextjs", "Supabase (Postgres)" all resolve. */
const KNOWN_DOMAINS: Record<string, string> = {
  // frontend / frameworks / build
  "next.js": "nextjs.org", nextjs: "nextjs.org", react: "react.dev", "react native": "reactnative.dev",
  vue: "vuejs.org", "vue.js": "vuejs.org", angular: "angular.dev", svelte: "svelte.dev", sveltekit: "svelte.dev",
  astro: "astro.build", remix: "remix.run", nuxt: "nuxt.com", solidjs: "solidjs.com", gatsby: "gatsbyjs.com",
  tailwind: "tailwindcss.com", "tailwind css": "tailwindcss.com", tailwindcss: "tailwindcss.com",
  "tailwind.config.ts": "tailwindcss.com", "tailwind.config.js": "tailwindcss.com",
  bootstrap: "getbootstrap.com", shadcn: "ui.shadcn.com", "shadcn/ui": "ui.shadcn.com", "material ui": "mui.com",
  mui: "mui.com", "chakra ui": "chakra-ui.com", "radix ui": "radix-ui.com", "framer motion": "framer.com",
  framer: "framer.com", redux: "redux.js.org", typescript: "typescriptlang.org", javascript: "developer.mozilla.org",
  vite: "vitejs.dev", webpack: "webpack.js.org", expo: "expo.dev", flutter: "flutter.dev",
  // backend / languages / orm
  "node.js": "nodejs.org", nodejs: "nodejs.org", node: "nodejs.org", express: "expressjs.com",
  "express.js": "expressjs.com", nestjs: "nestjs.com", python: "python.org", django: "djangoproject.com",
  flask: "flask.palletsprojects.com", fastapi: "fastapi.tiangolo.com", "ruby on rails": "rubyonrails.org",
  rails: "rubyonrails.org", ruby: "ruby-lang.org", php: "php.net", laravel: "laravel.com", go: "go.dev",
  golang: "go.dev", rust: "rust-lang.org", java: "java.com", spring: "spring.io", "spring boot": "spring.io",
  "c#": "dotnet.microsoft.com", ".net": "dotnet.microsoft.com", graphql: "graphql.org", trpc: "trpc.io",
  prisma: "prisma.io", drizzle: "orm.drizzle.team", "drizzle orm": "orm.drizzle.team",
  // databases
  postgresql: "postgresql.org", postgres: "postgresql.org", mysql: "mysql.com", mariadb: "mariadb.org",
  mongodb: "mongodb.com", mongo: "mongodb.com", redis: "redis.io", sqlite: "sqlite.org", supabase: "supabase.com",
  planetscale: "planetscale.com", neon: "neon.tech", firebase: "firebase.google.com", firestore: "firebase.google.com",
  dynamodb: "aws.amazon.com", cockroachdb: "cockroachlabs.com", elasticsearch: "elastic.co", snowflake: "snowflake.com",
  turso: "turso.tech", upstash: "upstash.com", convex: "convex.dev",
  // hosting / infra / cloud
  vercel: "vercel.com", netlify: "netlify.com", aws: "aws.amazon.com", "amazon web services": "aws.amazon.com",
  "amazon s3": "aws.amazon.com", s3: "aws.amazon.com", ec2: "aws.amazon.com", lambda: "aws.amazon.com",
  "aws lambda": "aws.amazon.com", amplify: "amplify.aws", "aws amplify": "amplify.aws", "amplify.yml": "amplify.aws",
  cloudflare: "cloudflare.com", "cloudflare workers": "cloudflare.com",
  "google cloud": "cloud.google.com", gcp: "cloud.google.com", "google cloud platform": "cloud.google.com",
  azure: "azure.microsoft.com", "microsoft azure": "azure.microsoft.com", digitalocean: "digitalocean.com",
  heroku: "heroku.com", render: "render.com", railway: "railway.app", "fly.io": "fly.io", fly: "fly.io",
  docker: "docker.com", dockerfile: "docker.com", kubernetes: "kubernetes.io", nginx: "nginx.org",
  // email
  resend: "resend.com", sendgrid: "sendgrid.com", postmark: "postmarkapp.com", mailgun: "mailgun.com",
  mailchimp: "mailchimp.com", "amazon ses": "aws.amazon.com", ses: "aws.amazon.com", loops: "loops.so",
  nodemailer: "nodemailer.com",
  // payments
  stripe: "stripe.com", paypal: "paypal.com", square: "squareup.com", "lemon squeezy": "lemonsqueezy.com",
  lemonsqueezy: "lemonsqueezy.com", paddle: "paddle.com", braintree: "braintreepayments.com", plaid: "plaid.com",
  // auth
  clerk: "clerk.com", auth0: "auth0.com", nextauth: "authjs.dev", "next-auth": "authjs.dev", "auth.js": "authjs.dev",
  okta: "okta.com", workos: "workos.com",
  // integrations / apis / saas
  twilio: "twilio.com", openai: "openai.com", anthropic: "anthropic.com", claude: "anthropic.com",
  "google maps": "google.com", "google analytics": "google.com", segment: "segment.com", posthog: "posthog.com",
  sentry: "sentry.io", datadog: "datadoghq.com", algolia: "algolia.com", contentful: "contentful.com",
  sanity: "sanity.io", strapi: "strapi.io", wordpress: "wordpress.org", shopify: "shopify.com",
  hubspot: "hubspot.com", salesforce: "salesforce.com", slack: "slack.com", discord: "discord.com",
  notion: "notion.so", airtable: "airtable.com", zapier: "zapier.com", quickbooks: "quickbooks.intuit.com",
  "google sheets": "google.com", cloudinary: "cloudinary.com", uploadthing: "uploadthing.com", mapbox: "mapbox.com",
  calendly: "calendly.com", intercom: "intercom.com", zendesk: "zendesk.com",
};

// Multi-word keys, longest first, so "spring boot" wins over "spring" on a
// substring match.
const MULTIWORD_KEYS = Object.keys(KNOWN_DOMAINS)
  .filter((k) => k.includes(" "))
  .sort((a, b) => b.length - a.length);

/** Best-effort website host for a tool NAME, using the built-in directory only.
    Returns null when the name isn't a recognized common tool (the long tail is
    covered by the saved `domain` from the AI lookup instead). */
function guessDomainFromName(name: string): string | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  if (KNOWN_DOMAINS[n]) return KNOWN_DOMAINS[n];
  // Normalize away punctuation the directory keys don't carry.
  const norm = n.replace(/[^a-z0-9.+#/ -]/g, " ").replace(/\s+/g, " ").trim();
  if (KNOWN_DOMAINS[norm]) return KNOWN_DOMAINS[norm];
  // A multi-word key appearing inside the name, e.g. "Supabase Auth (Postgres)".
  for (const key of MULTIWORD_KEYS) if (norm.includes(key)) return KNOWN_DOMAINS[key];
  // A single-word key matching a whole token, e.g. "Supabase (Postgres)" → postgres.
  const tokens = norm.split(/[\s/(),]+/).filter(Boolean);
  for (const t of tokens) if (KNOWN_DOMAINS[t]) return KNOWN_DOMAINS[t];
  return null;
}

/** Reduce a raw domain/URL to a bare host (drops protocol, leading www, path). */
function bareHost(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(/\s/g, "");
}

/** Curated, self-hosted logos that beat the generic favicon — official product
    icons we want pixel-perfect. Keyed by resolved host (see KNOWN_DOMAINS). */
const LOCAL_LOGOS: Record<string, string> = {
  "amplify.aws": "/images/brand/amplify.png",
};

/** Bundled logos for languages/standards that have a recognizable logo but no
    canonical website favicon to resolve (CSS, plain SQL). Keyed by lowercase
    name; matched only when domain resolution finds nothing. */
const LOCAL_LOGOS_BY_NAME: Record<string, string> = {
  css: "/images/brand/css.svg",
  css3: "/images/brand/css.svg",
  sql: "/images/brand/sql.svg",
  plpgsql: "/images/brand/sql.svg",
  "pl/pgsql": "/images/brand/sql.svg",
};

function localLogoForName(name: string): string | null {
  return LOCAL_LOGOS_BY_NAME[name.trim().toLowerCase()] ?? null;
}

/** Logo URLs to try for a host, best source first. Each that fails to load
    advances to the next (see the cascade in BrandLogo); the monogram shows only
    after every real source misses. */
function logoSources(host: string, displaySize: number): string[] {
  const out: string[] = [];
  // Curated, pixel-perfect override wins outright when we have one.
  if (LOCAL_LOGOS[host]) out.push(LOCAL_LOGOS[host]);
  const px = Math.max(64, displaySize * 2);
  const clientId = process.env.NEXT_PUBLIC_BRANDFETCH_CLIENT_ID;
  if (clientId) {
    // `/fallback/404` is essential: without it Brandfetch answers a miss with
    // its OWN placeholder image at HTTP 200, so onError never fires and we'd be
    // stuck on that placeholder. With it, a miss returns a real 404 → onError →
    // we drop to Google's faviconV2 below.
    out.push(`https://cdn.brandfetch.io/${host}/w/${px}/h/${px}/fallback/404?c=${clientId}`);
  }
  // faviconV2 (not the legacy s2 endpoint): picks the best source icon the site
  // offers — including high-res touch icons — instead of upscaling a 16px
  // favicon, which looks stretched/blurry above ~20px. This is the primary when
  // no Brandfetch client id is set, and the backstop when Brandfetch misses.
  // fallback_opts deliberately excludes URL: with it, unknown domains return a
  // generic placeholder with HTTP 200, so onError never fires and the monogram
  // never shows. Without it, a miss 404s → monogram.
  out.push(`https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE&url=https://${host}&size=${px}`);
  return out;
}

export function BrandLogo({
  domain,
  name,
  size = 22,
  plain = false,
  fallback,
}: {
  domain?: string | null;
  name?: string | null;
  size?: number;
  /** No white box / border / padding — for full-bleed icons (e.g. university
      crests) that look pinched inside the boxed chrome at larger sizes. */
  plain?: boolean;
  /** Text for the neutral fallback tile when no logo resolves or the image
      fails to load. Defaults to the first letter of `name`; pass a company's
      initials (e.g. "PG") to show those instead. */
  fallback?: string;
}) {
  // Prefer the saved domain; otherwise resolve a common tool by name.
  const host = (domain ? bareHost(domain) : "") || guessDomainFromName(name ?? "") || "";
  // No website host? Fall back to a bundled logo for known languages/standards.
  const localLogo = host ? null : localLogoForName(name ?? "");

  // Ordered sources tried in turn; onError advances the cursor. The monogram
  // shows only once every real source (Brandfetch → Google) has missed.
  const sources = host ? logoSources(host, size) : localLogo ? [localLogo] : [];
  const [idx, setIdx] = useState(0);

  // A new host/logo (e.g. the builder renamed the item) restarts the cascade.
  useEffect(() => setIdx(0), [host, localLogo]);

  const monogram =
    (fallback ?? "").trim() || (name ?? "").trim().charAt(0).toUpperCase() || "•";
  const src = sources[idx];

  if (!src) {
    return (
      <span
        className="brand-logo brand-logo--fallback"
        style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
        aria-hidden="true"
      >
        {monogram}
      </span>
    );
  }

  return (
    // Plain <img> (not next/image): tiny third-party favicons that don't benefit
    // from the optimizer and shouldn't require remotePatterns config. `key={src}`
    // remounts the element per source so each gets a clean load + onError.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={src}
      className={plain ? "brand-logo brand-logo--plain" : "brand-logo"}
      src={assetUrl(src)}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size }}
      loading="lazy"
      onError={() => setIdx((i) => i + 1)}
      aria-hidden="true"
    />
  );
}
