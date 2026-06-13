import type { ReactNode } from "react";
import Image from "next/image";

/* ============================================================
   Shared brand primitives (Krowe design system)
   Server components — purely presentational, no client hooks.
   ============================================================ */

export function EmberGlyph({ size = 14 }: { size?: number }) {
  const breathe = {
    animation: "breathe 3.5s ease-in-out infinite",
    transformOrigin: "8px 8px",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      style={{ flexShrink: 0, overflow: "visible" }}
      aria-hidden
    >
      <circle cx="8" cy="8" r="6" fill="var(--primary)" opacity="0.12" />
      <circle cx="8" cy="8" r="4" fill="var(--primary)" opacity="0.4" style={breathe} />
      <circle cx="8" cy="8" r="2.5" fill="var(--primary)" />
      <circle cx="9" cy="7" r="1" fill="var(--primary-accent)" style={{ ...breathe, animationDelay: "0.4s" }} />
    </svg>
  );
}

export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <Image
      src="/KroweIcon.png"
      alt=""
      aria-hidden
      width={size}
      height={size}
      style={{ width: size, height: size, objectFit: "contain", display: "block" }}
    />
  );
}

export function Wordmark({
  markSize = 26,
  fontSize = 19,
  ember = true,
}: {
  markSize?: number;
  fontSize?: number;
  ember?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <BrandMark size={markSize} />
      <span
        style={{
          fontFamily: "var(--font-sans)",
          fontWeight: 600,
          fontSize,
          letterSpacing: "-0.01em",
          color: "var(--foreground)",
        }}
      >
        Krowe
      </span>
      {ember && <EmberGlyph size={12} />}
    </div>
  );
}

export function TrustLine() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        color: "var(--muted-foreground)",
        fontFamily: "var(--font-sans)",
        fontSize: 12,
      }}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      </svg>
      Private by default. Your work stays yours.
    </div>
  );
}

/* ============================================================
   Mini-portal snapshot — a scaled, static recreation of the
   builder Build Board (the screen you sign in to).
   Real vocabulary: nav from app/b/layout.tsx, columns from
   components/task-board.tsx, "Build Board" header from app/b/page.tsx.
   ============================================================ */

function NavIcon({ name, size = 14 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    tasks: (
      <>
        <line x1="8" y1="6" x2="21" y2="6" />
        <line x1="8" y1="12" x2="21" y2="12" />
        <line x1="8" y1="18" x2="21" y2="18" />
        <line x1="3" y1="6" x2="3.01" y2="6" />
        <line x1="3" y1="12" x2="3.01" y2="12" />
        <line x1="3" y1="18" x2="3.01" y2="18" />
      </>
    ),
    engagements: (
      <>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    repo: (
      <>
        <line x1="6" y1="3" x2="6" y2="15" />
        <circle cx="18" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M18 9a9 9 0 0 1-9 9" />
      </>
    ),
    documents: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </>
    ),
    plus: (
      <>
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </>
    ),
    more: (
      <>
        <circle cx="5" cy="12" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {paths[name] ?? null}
    </svg>
  );
}

function MiniNav({
  icon,
  label,
  count,
  active,
}: {
  icon: string;
  label: string;
  count?: number;
  active?: boolean;
}) {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 9,
        height: 30,
        padding: "0 9px",
        borderRadius: "var(--radius-md)",
        background: active ? "var(--primary-soft)" : "transparent",
        color: active ? "var(--primary)" : "var(--foreground)",
        fontFamily: "var(--font-sans)",
        fontSize: 12.5,
        fontWeight: 500,
      }}
    >
      {active && (
        <span
          style={{
            position: "absolute",
            left: -9,
            top: 7,
            bottom: 7,
            width: 2,
            background: "var(--primary)",
            borderRadius: 2,
          }}
        />
      )}
      <NavIcon name={icon} size={14} />
      <span style={{ flex: 1 }}>{label}</span>
      {count != null && (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: active ? "var(--primary)" : "var(--muted-foreground)",
          }}
        >
          {count}
        </span>
      )}
    </div>
  );
}

const PRIORITY: Record<string, string> = {
  high: "var(--warning)",
  med: "color-mix(in srgb, var(--primary) 55%, var(--border))",
  low: "var(--success)",
};

function TaskCard({
  title,
  meta,
  priority = "med",
  done,
}: {
  title: string;
  meta: string;
  priority?: "high" | "med" | "low";
  done?: boolean;
}) {
  return (
    <div
      style={{
        background: "var(--background)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-1)",
        padding: "9px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 7 }}>
        {done ? (
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--success)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ marginTop: 2, flexShrink: 0 }}
            aria-hidden
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: PRIORITY[priority],
              marginTop: 4,
              flexShrink: 0,
            }}
          />
        )}
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 10.5,
            fontWeight: 600,
            lineHeight: 1.3,
            color: "var(--foreground)",
          }}
        >
          {title}
        </span>
      </div>
      <span
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 9,
          color: "var(--muted-foreground)",
          paddingLeft: 13,
        }}
      >
        {meta}
      </span>
    </div>
  );
}

function Column({
  label,
  count,
  dot,
  children,
}: {
  label: string;
  count: number;
  dot: string;
  children?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 2px" }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: dot }} />
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 9.5,
            fontWeight: 600,
            letterSpacing: "0.07em",
            textTransform: "uppercase",
            color: "var(--muted-foreground)",
          }}
        >
          {label}
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--faint-foreground)" }}>
          {count}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
    </div>
  );
}

export function PortalPreview() {
  return (
    <div
      style={{
        width: 760,
        height: 496,
        display: "flex",
        overflow: "hidden",
        background: "var(--background)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-3)",
      }}
    >
      {/* Sidebar */}
      <aside
        style={{
          width: 176,
          flexShrink: 0,
          background: "var(--surface-subtle)",
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          padding: "16px 12px 12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 6px 16px" }}>
          <BrandMark size={20} />
          <span
            style={{
              fontFamily: "var(--font-sans)",
              fontWeight: 700,
              fontSize: 15,
              letterSpacing: "-0.01em",
              color: "var(--foreground)",
            }}
          >
            Krowe
          </span>
          <EmberGlyph size={10} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <MiniNav icon="tasks" label="Tasks" active />
          <MiniNav icon="engagements" label="Engagements" count={2} />
          <MiniNav icon="repo" label="Repo" />
          <MiniNav icon="documents" label="Documents" count={5} />
        </div>
        <div
          style={{
            marginTop: 14,
            height: 30,
            borderRadius: "var(--radius-md)",
            border: "1px dashed var(--border)",
            color: "var(--muted-foreground)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            fontFamily: "var(--font-sans)",
            fontSize: 12,
          }}
        >
          <NavIcon name="plus" size={13} /> New engagement
        </div>
        <div
          style={{
            marginTop: "auto",
            borderTop: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "10px 4px 0",
          }}
        >
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: "var(--radius-full)",
              background: "linear-gradient(135deg, var(--primary) 0%, var(--primary-accent) 100%)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-sans)",
              fontSize: 10.5,
              fontWeight: 700,
            }}
          >
            JR
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "var(--font-sans)", fontSize: 11.5, fontWeight: 600, color: "var(--foreground)" }}>
              Jordan
            </div>
            <div
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 9.5,
                color: "var(--muted-foreground)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              jordan@acme.co
            </div>
          </div>
          <span style={{ color: "var(--muted-foreground)" }}>
            <NavIcon name="more" size={13} />
          </span>
        </div>
      </aside>

      {/* Content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <header style={{ padding: "16px 20px 13px", borderBottom: "1px solid var(--border)", background: "var(--background)" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontFamily: "var(--font-sans)",
              fontSize: 9.5,
              fontWeight: 500,
              color: "var(--muted-foreground)",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: 5,
              whiteSpace: "nowrap",
            }}
          >
            <EmberGlyph size={11} /> Welcome back
          </div>
          <h3 style={{ fontFamily: "var(--font-serif)", margin: 0, fontSize: 22, color: "var(--foreground)", letterSpacing: "-0.01em" }}>
            Build Board
          </h3>
        </header>
        <div className="krowe-blueprint-canvas" style={{ flex: 1, padding: "16px 18px", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, alignContent: "start" }}>
          <Column label="Inbox" count={2} dot="var(--faint-foreground)">
            <TaskCard title="Supabase RLS policies" meta="Setup · 2d" priority="med" />
            <TaskCard title="Quote PDF export" meta="Feature · 3d" priority="low" />
          </Column>
          <Column label="In Progress" count={1} dot="#3b82f6">
            <TaskCard title="Wire GitHub OAuth callback" meta="Integration · today" priority="high" />
          </Column>
          <Column label="Approval" count={1} dot="var(--warning)">
            <TaskCard title="Add user T&C agreement" meta="Legal · 1d" priority="med" />
          </Column>
          <Column label="Done" count={1} dot="var(--success)">
            <TaskCard title="Login page redesign" meta="UI · yesterday" done />
          </Column>
        </div>
      </div>
    </div>
  );
}
