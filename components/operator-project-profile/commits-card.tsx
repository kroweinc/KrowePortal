import { EmberGlyph } from "./ember-glyph";
import { Icon } from "./icon";
import type { RepoContext } from "@/lib/github/types";

type Commit = RepoContext["recentCommits"][number];

interface CommitsCardProps {
  commits: Commit[];
}

const SPARK_DAYS = 14;
const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function dayBucketsFromCommits(commits: Commit[]): number[] {
  const now = Date.now();
  const buckets = new Array(SPARK_DAYS).fill(0);
  for (const c of commits) {
    if (!c.date) continue;
    const t = new Date(c.date).getTime();
    if (Number.isNaN(t)) continue;
    const daysAgo = Math.floor((now - t) / 86_400_000);
    if (daysAgo < 0 || daysAgo >= SPARK_DAYS) continue;
    buckets[SPARK_DAYS - 1 - daysAgo] += 1;
  }
  return buckets;
}

function relativeDay(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "unknown";
  const daysAgo = Math.floor((Date.now() - t) / 86_400_000);
  if (daysAgo <= 0) return "today";
  return rtf.format(-daysAgo, "day");
}

function initials(name: string | undefined | null): string {
  if (!name) return "?";
  return (
    name
      .split(/\s+/)
      .map((p) => p.replace(".", "").charAt(0))
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

export function CommitsCard({ commits }: CommitsCardProps) {
  const activity = dayBucketsFromCommits(commits);
  const maxBar = Math.max(1, ...activity);

  // Group by relative-day label, preserving order from `commits`
  const groups: { when: string; items: Commit[] }[] = [];
  const seen = new Map<string, Commit[]>();
  for (const c of commits) {
    const when = relativeDay(c.date);
    let bucket = seen.get(when);
    if (!bucket) {
      bucket = [];
      seen.set(when, bucket);
      groups.push({ when, items: bucket });
    }
    bucket.push(c);
  }

  if (commits.length === 0) {
    return (
      <div className="k-card k-card-pad">
        <div className="section-head">
          <div className="ember-wrap">
            <Icon name="commit" size={14} color="var(--primary)" />
          </div>
          <h2>Recent commits</h2>
        </div>
        <p style={{ fontSize: 14, color: "var(--muted-foreground)" }}>
          No recent updates from your builder yet.
        </p>
      </div>
    );
  }

  return (
    <div className="k-card k-card-pad">
      <div className="section-head">
        <div className="ember-wrap">
          <Icon name="commit" size={14} color="var(--primary)" />
        </div>
        <h2>Recent commits</h2>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: "var(--font-sans)",
            fontSize: 11.5,
            fontWeight: 600,
            color: "var(--muted-foreground)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          14d · {commits.length} commit{commits.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Activity sparkline */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 3,
          height: 42,
          padding: "0 0 10px",
          marginBottom: 18,
          borderBottom: "1px solid var(--border)",
        }}
      >
        {activity.map((v, i) => {
          const isLast = i === activity.length - 1;
          const h = v === 0 ? 3 : Math.max(5, Math.round((v / maxBar) * 32));
          return (
            <div
              key={i}
              style={{ flex: 1, display: "flex", alignItems: "flex-end", height: "100%" }}
            >
              <div
                style={{
                  width: "100%",
                  height: h,
                  background:
                    v === 0
                      ? "color-mix(in srgb, var(--muted-foreground) 18%, transparent)"
                      : isLast
                        ? "var(--primary)"
                        : "color-mix(in srgb, var(--primary) 50%, transparent)",
                  borderRadius: 2,
                  transition: "all var(--duration-slow) var(--ease-out-smooth)",
                }}
                title={`${v} commit${v === 1 ? "" : "s"}`}
              />
            </div>
          );
        })}
        <div
          style={{
            marginLeft: 8,
            fontFamily: "var(--font-sans)",
            fontSize: 10.5,
            fontWeight: 600,
            color: "var(--muted-foreground)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            alignSelf: "flex-end",
            paddingBottom: 1,
            flexShrink: 0,
          }}
        >
          today
        </div>
      </div>

      {/* Journal entries */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {groups.map((g, gi) => (
          <div key={g.when} style={{ position: "relative" }}>
            {/* Dateline */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                margin: gi === 0 ? "0 0 10px" : "20px 0 10px",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: 15,
                  fontStyle: "italic",
                  color: "var(--muted-foreground)",
                  textTransform: "lowercase",
                }}
              >
                {g.when}
              </span>
              <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--muted-foreground)",
                }}
              >
                {g.items.length}
              </span>
            </div>

            <div style={{ position: "relative", paddingLeft: 18 }}>
              <div
                style={{
                  position: "absolute",
                  left: 5,
                  top: 8,
                  bottom: 8,
                  width: 1,
                  background: "var(--border)",
                }}
              />
              {g.items.map((c) => {
                const isMerge = /^merge\b/i.test(c.message);
                return (
                  <div
                    key={c.sha}
                    style={{
                      position: "relative",
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: 14,
                      alignItems: "baseline",
                      padding: "8px 0",
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        left: -18,
                        top: 13,
                        width: 11,
                        height: 11,
                        borderRadius: "50%",
                        background: "var(--background)",
                        border: `2px solid ${
                          isMerge ? "var(--primary)" : "var(--muted-foreground)"
                        }`,
                      }}
                    />
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontFamily: "var(--font-sans)",
                          fontSize: 14,
                          fontWeight: 500,
                          color: "var(--foreground)",
                          lineHeight: 1.45,
                        }}
                      >
                        {c.message}
                      </div>
                      <div
                        style={{
                          marginTop: 4,
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 18,
                            height: 18,
                            borderRadius: "50%",
                            background: "var(--primary-soft)",
                            color: "var(--primary)",
                            fontFamily: "var(--font-sans)",
                            fontSize: 9.5,
                            fontWeight: 700,
                            letterSpacing: 0,
                            textTransform: "uppercase",
                          }}
                        >
                          {initials(c.author?.name)}
                        </span>
                        <span
                          style={{
                            fontFamily: "var(--font-sans)",
                            fontSize: 12,
                            color: "var(--muted-foreground)",
                          }}
                        >
                          {c.author?.name ?? "unknown"}
                        </span>
                      </div>
                    </div>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 11.5,
                        color: "var(--muted-foreground)",
                        background: "var(--surface-subtle)",
                        padding: "2px 8px",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border)",
                        alignSelf: "flex-start",
                        marginTop: 2,
                      }}
                    >
                      {c.sha}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CommitsCardSkeleton() {
  return (
    <div className="k-card k-card-pad">
      <div className="section-head">
        <div className="ember-wrap">
          <Icon name="commit" size={14} color="var(--primary)" />
        </div>
        <h2>Recent commits</h2>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ display: "flex", gap: 10 }}>
            <div
              style={{
                width: 11,
                height: 11,
                marginTop: 4,
                borderRadius: "50%",
                background: "var(--surface-subtle)",
                border: "1px solid var(--border)",
              }}
            />
            <div style={{ flex: 1 }}>
              <div
                style={{
                  height: 14,
                  width: "85%",
                  background: "var(--surface-subtle)",
                  borderRadius: 4,
                  marginBottom: 6,
                }}
              />
              <div
                style={{
                  height: 12,
                  width: "30%",
                  background: "var(--surface-subtle)",
                  borderRadius: 4,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
