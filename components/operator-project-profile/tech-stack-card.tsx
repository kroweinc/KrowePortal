import { EmberGlyph } from "./ember-glyph";
import { Icon, type IconName } from "./icon";
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
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: colorFor(l.name),
                  }}
                />
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
                  {layer.items.map((it) => (
                    <span
                      key={it}
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        color: "var(--foreground)",
                        fontWeight: 500,
                        padding: "3px 9px",
                        background: "var(--surface-subtle)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-sm)",
                      }}
                    >
                      {it}
                    </span>
                  ))}
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
