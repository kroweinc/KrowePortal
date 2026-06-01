import { EmberGlyph } from "./ember-glyph";
import type { ProjectProfile } from "@/lib/actions/generate-project-profile";

export type OverviewStats = {
  commits14d: number;
  contributors: number;
  branchCount: number;
  lastSyncIso: string;
};

interface OverviewCardProps {
  profilePromise: Promise<ProjectProfile | null>;
  statsPromise: Promise<OverviewStats>;
}

const STATE_LABEL: Record<ProjectProfile["currentState"], string> = {
  active: "Actively developed",
  early: "Just getting started",
  mature: "Stable and running",
  dormant: "Paused",
};

const STATE_CLASS: Record<ProjectProfile["currentState"], string> = {
  active: "",
  early: "warn",
  mature: "muted",
  dormant: "muted",
};

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function lastSyncLabel(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffMs = then - Date.now();
  const diffMin = Math.round(diffMs / 60_000);
  if (Math.abs(diffMin) < 1) return "now";
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");
  const diffHr = Math.round(diffMin / 60);
  if (Math.abs(diffHr) < 24) return rtf.format(diffHr, "hour");
  const diffDay = Math.round(diffHr / 24);
  return rtf.format(diffDay, "day");
}

export async function OverviewCard({ profilePromise, statsPromise }: OverviewCardProps) {
  const [profile, stats] = await Promise.all([profilePromise, statsPromise]);

  if (!profile) {
    return (
      <div className="k-card k-card-pad">
        <div className="section-head">
          <div className="ember-wrap">
            <EmberGlyph size={12} />
          </div>
          <h2>Overview</h2>
        </div>
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 14.5,
            color: "var(--muted-foreground)",
          }}
        >
          We couldn&apos;t put together a summary right now. Check back soon — your builder may
          still be setting things up.
        </p>
      </div>
    );
  }

  const stateLabel = STATE_LABEL[profile.currentState] ?? profile.currentState;
  const stateClass = STATE_CLASS[profile.currentState] ?? "";

  const statItems = [
    {
      label: "commits",
      value: String(stats.commits14d),
      unit: "/ 2w",
    },
    {
      label: stats.contributors === 1 ? "contributor" : "contributors",
      value: String(stats.contributors),
    },
    {
      label: stats.branchCount === 1 ? "branch" : "branches",
      value: String(stats.branchCount),
      unit: "active",
    },
    {
      label: "last sync",
      value: lastSyncLabel(stats.lastSyncIso),
    },
  ];

  return (
    <div
      className="k-card"
      style={{
        padding: "30px 36px 28px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Sunrise wash in top-right corner */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: -80,
          right: -80,
          width: 280,
          height: 280,
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--primary) 8%, transparent) 0%, transparent 60%)",
          pointerEvents: "none",
        }}
      />

      {/* Section head */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 22,
          position: "relative",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: 11,
              fontWeight: 600,
              color: "var(--muted-foreground)",
              textTransform: "uppercase",
              letterSpacing: "0.14em",
            }}
          >
            The Read
          </span>
          <span style={{ width: 24, height: 1, background: "var(--border)" }} />
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              fontFamily: "var(--font-sans)",
              fontSize: 13,
              fontWeight: 500,
              color: "var(--foreground)",
            }}
          >
            <EmberGlyph size={12} animated />
            Overview
          </span>
        </div>
        <span className={`status-badge ${stateClass}`.trim()}>
          {profile.currentState === "active" ? <span className="status-dot" /> : null}
          {stateLabel}
        </span>
      </div>

      {/* Lead paragraph — NO drop cap, just clean body text */}
      <p
        style={{
          margin: "0 0 28px",
          fontFamily: "var(--font-sans)",
          fontSize: 17,
          lineHeight: 1.6,
          color: "var(--foreground)",
          textWrap: "pretty",
        }}
      >
        {profile.summary}
      </p>

      {/* Stat strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 0,
          padding: "18px 0",
          marginBottom: 26,
          borderTop: "1px solid var(--border)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {statItems.map((s, i) => (
          <div
            key={s.label}
            style={{
              padding: "0 22px",
              borderLeft: i === 0 ? "none" : "1px solid var(--border)",
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 28,
                fontWeight: 500,
                color: "var(--foreground)",
                letterSpacing: "-0.01em",
                display: "flex",
                alignItems: "baseline",
                gap: 6,
              }}
            >
              {s.value}
              {s.unit ? (
                <span
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: 12,
                    fontWeight: 500,
                    color: "var(--muted-foreground)",
                    letterSpacing: 0,
                  }}
                >
                  {s.unit}
                </span>
              ) : null}
            </div>
            <div
              style={{
                marginTop: 4,
                fontFamily: "var(--font-sans)",
                fontSize: 11,
                fontWeight: 600,
                color: "var(--muted-foreground)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
              }}
            >
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Pull-quote + numbered features */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.2fr)",
          gap: 40,
          marginBottom: 22,
        }}
      >
        <div
          style={{
            paddingLeft: 18,
            borderLeft: "2px solid var(--primary)",
          }}
        >
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
            Who it&apos;s for
          </div>
          <p
            style={{
              margin: 0,
              fontFamily: "var(--font-serif)",
              fontSize: 19,
              lineHeight: 1.45,
              color: "var(--foreground)",
              fontStyle: "italic",
              textWrap: "pretty",
            }}
          >
            “{profile.audience}”
          </p>
        </div>

        <div>
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
            What it does
          </div>
          <ol
            style={{
              margin: 0,
              padding: 0,
              listStyle: "none",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "10px 24px",
            }}
          >
            {profile.features.map((f, i) => (
              <li
                key={i}
                style={{
                  display: "grid",
                  gridTemplateColumns: "24px 1fr",
                  gap: 10,
                  fontFamily: "var(--font-sans)",
                  fontSize: 13.5,
                  lineHeight: 1.5,
                  color: "var(--foreground)",
                  alignItems: "baseline",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontSize: 17,
                    color: "var(--primary)",
                    fontWeight: 400,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>{f}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* Footnote */}
      <p
        style={{
          margin: 0,
          fontFamily: "var(--font-serif)",
          fontSize: 15,
          fontStyle: "italic",
          color: "var(--muted-foreground)",
          paddingTop: 18,
          borderTop: "1px solid var(--border)",
          textWrap: "pretty",
        }}
      >
        — {profile.stateRationale}
      </p>
    </div>
  );
}

export function OverviewCardSkeleton() {
  return (
    <div className="k-card" style={{ padding: "30px 36px 28px" }}>
      <div className="section-head">
        <div className="ember-wrap">
          <EmberGlyph size={12} />
        </div>
        <h2>Overview</h2>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div
          style={{
            height: 18,
            background: "var(--surface-subtle)",
            borderRadius: 4,
            width: "92%",
          }}
        />
        <div
          style={{
            height: 18,
            background: "var(--surface-subtle)",
            borderRadius: 4,
            width: "78%",
          }}
        />
        <div
          style={{
            height: 18,
            background: "var(--surface-subtle)",
            borderRadius: 4,
            width: "60%",
          }}
        />
      </div>
    </div>
  );
}
