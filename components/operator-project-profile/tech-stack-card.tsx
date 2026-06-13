import { EmberGlyph } from "./ember-glyph";
import { Icon, type IconName } from "./icon";
import { BrandLogo } from "@/components/prd/brand-logo";
import type { RepoContext } from "@/lib/github/types";
import type { ArchLayer } from "@/lib/operator-project/derive-arch-layers";

interface TechStackCardProps {
  languages: RepoContext["languages"];
  layers: ArchLayer[];
}

const LANG_COLORS: Record<string, string> = {
  typescript: "#3178c6",
  javascript: "#f7df1e",
  python: "#3572a5",
  go: "#00add8",
  rust: "#dea584",
  java: "#b07219",
  kotlin: "#7f52ff",
  swift: "#fa7343",
  ruby: "#cc342d",
  php: "#777bb4",
  css: "#f9a825",
  scss: "#c6538c",
  html: "#e34c26",
  shell: "#89e051",
  dockerfile: "#384d54",
  plpgsql: "#9b4dca",
  sql: "#336791",
  vue: "#41b883",
  svelte: "#ff3e00",
  mdx: "#f9ac00",
  json: "#888",
};

function colorFor(name: string): string {
  return LANG_COLORS[name.toLowerCase()] ?? "#888";
}

/* Brand accent for each architecture tag — recognizable product colors where we
   have them, otherwise a stable hue hashed from the name so every tag still
   reads as its own color instead of uniform gray. Near-black brands are left
   out on purpose (they'd tint to the same gray) and fall through to the hash. */
const BRAND_COLORS: Record<string, string> = {
  ...LANG_COLORS,
  react: "#61dafb", "react native": "#61dafb", vue: "#41b883", "vue.js": "#41b883",
  svelte: "#ff3e00", sveltekit: "#ff3e00", angular: "#dd0031", astro: "#ff5d01",
  nuxt: "#00dc82", tailwind: "#38bdf8", tailwindcss: "#38bdf8", "tailwind css": "#38bdf8",
  redux: "#764abc", vite: "#646cff", "framer motion": "#0055ff", framer: "#0055ff",
  nestjs: "#e0234e", django: "#0c4b33", flask: "#1f6feb", fastapi: "#009688",
  rails: "#cc0000", "ruby on rails": "#cc0000", laravel: "#ff2d20", spring: "#6db33f",
  "spring boot": "#6db33f", graphql: "#e10098", trpc: "#398ccb", prisma: "#5a67d8",
  drizzle: "#52b000", "drizzle orm": "#52b000",
  postgresql: "#336791", postgres: "#336791", mysql: "#4479a1", mariadb: "#003545",
  mongodb: "#47a248", mongo: "#47a248", redis: "#ff4438", sqlite: "#0f80cc",
  supabase: "#3ecf8e", firebase: "#ffa000", firestore: "#ffa000", neon: "#00b389",
  planetscale: "#6b46c1", convex: "#ee342f", upstash: "#00c98d",
  netlify: "#00c7b7", aws: "#ff9900", "amazon web services": "#ff9900",
  cloudflare: "#f38020", "google cloud": "#4285f4", gcp: "#4285f4",
  azure: "#0078d4", digitalocean: "#0080ff", docker: "#2496ed", kubernetes: "#326ce5",
  nginx: "#009639", railway: "#a653f5", render: "#5d3fd3",
  stripe: "#635bff", paypal: "#0070ba", plaid: "#0a85ea",
  clerk: "#6c47ff", auth0: "#eb5424", workos: "#6363f1", okta: "#007dc1",
  resend: "#5b5bd6", sendgrid: "#1a82e2", mailgun: "#c02126",
  twilio: "#f22f46", openai: "#10a37f", anthropic: "#d97757", claude: "#d97757",
  sentry: "#9e6cd9", posthog: "#f54e00", datadog: "#632ca6", algolia: "#5468ff",
  sanity: "#f03e2f", strapi: "#4945ff", contentful: "#2478cc", shopify: "#7ab55c",
  hubspot: "#ff7a59", salesforce: "#00a1e0", slack: "#611f69", discord: "#5865f2",
  airtable: "#fcb400",
};

/** Stable 0–359 hue derived from a name, so unknown tags get a consistent,
    distinct color across renders. */
function hueFromName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** Accent color for an architecture tag. Matches the whole normalized name, then
    a single token (so "Supabase (Postgres)" → supabase), then a hashed hue. */
function tagColor(raw: string): string {
  const n = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.+#/ -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (BRAND_COLORS[n]) return BRAND_COLORS[n];
  for (const t of n.split(/[\s/(),]+/).filter(Boolean)) {
    if (BRAND_COLORS[t]) return BRAND_COLORS[t];
  }
  return `hsl(${hueFromName(n)} 60% 48%)`;
}

export function TechStackCard({ languages, layers }: TechStackCardProps) {
  const total = languages.reduce((s, l) => s + l.pct, 0) || 1;
  const minWeight = 4;
  const weights = languages.map((l) => Math.max(minWeight, (l.pct / total) * 100));
  const weightTotal = weights.reduce((a, b) => a + b, 0) || 1;

  return (
    <div className="k-card k-card-pad">
      <div className="section-head">
        <div className="ember-wrap">
          <Icon name="code" size={14} color="var(--primary)" />
        </div>
        <h2>Tech stack</h2>
      </div>

      {languages.length > 0 ? (
        <>
          <div
            style={{
              color: "var(--muted-foreground)",
              marginBottom: 10,
              fontFamily: "var(--font-sans)",
              fontSize: 11,
              letterSpacing: "0.14em",
              fontWeight: 600,
              textTransform: "uppercase",
            }}
          >
            Composition
          </div>

          <div
            style={{
              display: "flex",
              height: 96,
              gap: 3,
              marginBottom: 20,
              borderRadius: "var(--radius-md)",
              overflow: "hidden",
              background: "var(--surface-subtle)",
              padding: 3,
            }}
          >
            {languages.map((l, i) => {
              const w = (weights[i] / weightTotal) * 100;
              const isTiny = w < 10;
              const color = colorFor(l.name);
              return (
                <div
                  key={l.name}
                  style={{
                    flex: `${weights[i]} 1 0`,
                    minWidth: 0,
                    background: `color-mix(in srgb, ${color} 14%, var(--background))`,
                    border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
                    borderRadius: "var(--radius-sm)",
                    padding: isTiny ? "8px 6px" : "12px 14px",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    position: "relative",
                    overflow: "hidden",
                  }}
                  title={`${l.name} · ${l.pct}%`}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      minWidth: 0,
                    }}
                  >
                    {isTiny ? null : <BrandLogo name={l.name} size={16} />}
                    <span
                      style={{
                        fontFamily: "var(--font-sans)",
                        fontSize: isTiny ? 0 : 12,
                        fontWeight: 600,
                        color,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {l.name}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 3,
                      fontFamily: "var(--font-mono)",
                      color: "var(--foreground)",
                    }}
                  >
                    <span
                      style={{
                        fontSize: isTiny ? 11 : 22,
                        fontWeight: 500,
                        letterSpacing: "-0.02em",
                      }}
                    >
                      {l.pct < 1 ? "<1" : Math.round(l.pct)}
                    </span>
                    <span style={{ fontSize: isTiny ? 9 : 12, color: "var(--muted-foreground)" }}>
                      %
                    </span>
                  </div>
                  {isTiny ? (
                    <div
                      style={{
                        position: "absolute",
                        top: 4,
                        right: 6,
                        width: 5,
                        height: 5,
                        borderRadius: "50%",
                        background: color,
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "4px 14px",
              marginBottom: 28,
            }}
          >
            {languages.map((l) => (
              <div
                key={l.name}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontFamily: "var(--font-sans)",
                  fontSize: 12,
                  color: "var(--muted-foreground)",
                }}
              >
                <BrandLogo name={l.name} size={14} />
                {l.name}
              </div>
            ))}
          </div>
        </>
      ) : null}

      {layers.length > 0 ? (
        <>
          <div
            style={{
              color: "var(--muted-foreground)",
              marginBottom: 12,
              fontFamily: "var(--font-sans)",
              fontSize: 11,
              letterSpacing: "0.14em",
              fontWeight: 600,
              textTransform: "uppercase",
            }}
          >
            Architecture
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 0,
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              background: "var(--surface-subtle)",
              overflow: "hidden",
            }}
          >
            {layers.map((layer, i) => (
              <div
                key={layer.role}
                style={{
                  display: "grid",
                  gridTemplateColumns: "88px 1fr auto",
                  alignItems: "center",
                  gap: 14,
                  padding: "14px 16px",
                  background: "var(--background)",
                  borderBottom: i === layers.length - 1 ? "none" : "1px solid var(--border)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10.5,
                      color: "var(--muted-foreground)",
                      background: "var(--surface-subtle)",
                      padding: "2px 6px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--border)",
                      letterSpacing: "0.05em",
                    }}
                  >
                    L{i + 1}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-sans)",
                      fontSize: 10.5,
                      fontWeight: 600,
                      color: "var(--muted-foreground)",
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                    }}
                  >
                    {layer.role}
                  </span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {layer.items.map((it) => {
                    const c = tagColor(it);
                    return (
                      <span
                        key={it}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          fontFamily: "var(--font-mono)",
                          fontSize: 12,
                          color: `color-mix(in srgb, ${c} 50%, var(--foreground))`,
                          fontWeight: 500,
                          padding: "3px 9px 3px 5px",
                          background: `color-mix(in srgb, ${c} 12%, var(--background))`,
                          border: `1px solid color-mix(in srgb, ${c} 34%, transparent)`,
                          borderRadius: "var(--radius-sm)",
                        }}
                      >
                        <BrandLogo name={it} size={16} />
                        {it}
                      </span>
                    );
                  })}
                </div>
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: "var(--radius-md)",
                    background: "var(--surface-subtle)",
                    border: "1px solid var(--border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: layer.accent,
                    flexShrink: 0,
                  }}
                >
                  <Icon name={layer.icon as IconName} size={15} color="currentColor" />
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {languages.length === 0 && layers.length === 0 ? (
        <p style={{ fontSize: 14, color: "var(--muted-foreground)" }}>
          No language or architecture data yet.
        </p>
      ) : null}
    </div>
  );
}

export function TechStackCardSkeleton() {
  return (
    <div className="k-card k-card-pad">
      <div className="section-head">
        <div className="ember-wrap">
          <EmberGlyph size={12} />
        </div>
        <h2>Tech stack</h2>
      </div>
      <div
        style={{
          height: 96,
          background: "var(--surface-subtle)",
          borderRadius: "var(--radius-md)",
          marginBottom: 20,
        }}
      />
      <div
        style={{
          height: 14,
          background: "var(--surface-subtle)",
          width: "60%",
          borderRadius: 4,
          marginBottom: 18,
        }}
      />
      <div
        style={{
          height: 56,
          background: "var(--surface-subtle)",
          borderRadius: "var(--radius-md)",
        }}
      />
    </div>
  );
}
