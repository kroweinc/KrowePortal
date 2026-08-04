"use client";

import type { CSSProperties, ReactNode } from "react";
import { BrandLogo } from "@/components/prd/brand-logo";
import { WzIcon } from "./wizard-shell";

/* ============================================================
   LIVING ARTIFACT PREVIEWS — assemble on the sunrise stage as the
   builder fills the intake. Neutral palette (the orange is reserved
   for the left CTA).
   ============================================================ */

type StatusTone = "muted" | "active" | "ready";

function StageWindow({ titlebar, status, statusTone = "muted", children, width = 462 }: {
  titlebar: string; status?: string; statusTone?: StatusTone; children: ReactNode; width?: number;
}) {
  const tone = {
    muted: { bg: "var(--surface-subtle)", fg: "var(--muted-foreground)", bd: "var(--border)" },
    active: { bg: "var(--success-soft)", fg: "var(--success)", bd: "transparent" },
    ready: { bg: "color-mix(in oklch, var(--foreground) 6%, transparent)", fg: "var(--foreground)", bd: "var(--border)" },
  }[statusTone];
  return (
    <div style={{
      width, background: "var(--background)", border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-3)", overflow: "hidden",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", gap: 5 }}>
          {["#e5d9cf", "#ead9c9", "#efdcc9"].map((c, i) => <span key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: c }} />)}
        </div>
        <span style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 600, color: "var(--muted-foreground)", letterSpacing: "0.01em" }}>{titlebar}</span>
        {status && (
          <span style={{ marginLeft: "auto", fontFamily: "var(--font-sans)", fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", padding: "3px 9px", borderRadius: "var(--radius-full)", background: tone.bg, color: tone.fg, border: `1px solid ${tone.bd}` }}>{status}</span>
        )}
      </div>
      <div style={{ padding: 18 }}>{children}</div>
    </div>
  );
}

function MetaRow({ label, value, mono, glyph }: { label: string; value?: string; mono?: boolean; glyph?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <span style={{ fontFamily: "var(--font-sans)", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted-foreground)" }}>{label}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        {glyph}
        <span style={{ fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)", fontSize: 13.5, color: value ? "var(--foreground)" : "var(--border)", fontWeight: value ? 500 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 230 }}>{value || "—"}</span>
      </span>
    </div>
  );
}

function Seat({ initials, name, role, state }: { initials: string; name: string; role: string; state?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
      <div style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--surface-subtle)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 11, color: "var(--foreground)" }}>{initials}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600, color: "var(--foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
        <div style={{ fontFamily: "var(--font-sans)", fontSize: 11, color: "var(--muted-foreground)" }}>{role}</div>
      </div>
      {state && <span style={{ fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted-foreground)", border: "1px solid var(--border)", borderRadius: "var(--radius-full)", padding: "2px 8px" }}>{state}</span>}
    </div>
  );
}

const divider: CSSProperties = { height: 1, background: "var(--border)", margin: "16px 0" };

function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";
}

/* ---------- Fork intro — the portal they're signing into ---------- */
export function PortalTeaserStage() {
  const rows = [
    { n: "Acme Bakery", m: "PRD · Quote signed", t: "Active" },
    { n: "Northwind app rebuild", m: "Contract out for signature", t: "Pitch" },
    { n: "Harbor coffee subscription", m: "Board · 6 open tasks", t: "Active" },
  ];
  return (
    <StageWindow titlebar="Krowe · Home" status="3 clients" statusTone="ready" width={470}>
      <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
        {rows.map((e, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: "var(--surface-subtle)" }}>
            <div style={{ width: 30, height: 30, borderRadius: "var(--radius-md)", background: "var(--background)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 12, color: "var(--foreground)" }}>{e.n[0]}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "var(--font-sans)", fontSize: 13.5, fontWeight: 600, color: "var(--foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.n}</div>
              <div style={{ fontFamily: "var(--font-sans)", fontSize: 11.5, color: "var(--muted-foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.m}</div>
            </div>
            <span style={{ fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted-foreground)" }}>{e.t}</span>
          </div>
        ))}
      </div>
    </StageWindow>
  );
}

/* ---------- Identity — the builder's profile card ---------- */
export function IdentityStage({ name, agency, role, avatarUrl, domain }: {
  name?: string; agency?: string; role?: string; avatarUrl?: string | null;
  /** Bare host from the agency website — resolves the real brand logo. */
  domain?: string;
}) {
  const displayName = (name || "").trim() || "Your name";
  const roleLine = [(role || "").trim(), (agency || "").trim()].filter(Boolean).join(" · ");
  const filled = !!(name || agency || role || domain);
  return (
    <StageWindow titlebar="Your profile" status={filled ? "Draft" : "New"} statusTone="muted">
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
        {avatarUrl ? (
          // Signed URLs rotate per render, so a plain img keeps this simple.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" aria-hidden="true" style={{ width: 52, height: 52, borderRadius: "50%", objectFit: "cover", border: "1px solid var(--border)" }} />
        ) : (
          <div style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--surface-subtle)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 17, color: "var(--foreground)" }}>{initialsOf(displayName)}</div>
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "var(--font-serif)", fontSize: 22, lineHeight: 1.15, letterSpacing: "-0.01em", color: "var(--foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{displayName}</div>
          <div style={{ fontFamily: "var(--font-sans)", fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{roleLine || "Independent builder"}</div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <MetaRow
          label="Agency"
          value={(agency || "").trim()}
          glyph={domain ? <BrandLogo domain={domain} name={agency || domain} size={20} /> : undefined}
        />
        <MetaRow label="Website" value={domain} mono />
        <MetaRow label="Role" value={(role || "").trim()} />
      </div>
    </StageWindow>
  );
}

/* ---------- Agency — discipline + size snapshot ---------- */
export function AgencyStage({ typeLabel, sizeLabel }: { typeLabel?: string; sizeLabel?: string }) {
  const set = !!(typeLabel || sizeLabel);
  return (
    <StageWindow titlebar="Your agency" status={set ? "Set" : "Draft"} statusTone={set ? "ready" : "muted"}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <MetaRow label="Discipline" value={typeLabel} />
        <div style={divider} />
        <MetaRow label="Team size" value={sizeLabel} />
      </div>
    </StageWindow>
  );
}

/* ---------- Charging — the rate that seeds every quote ---------- */
export function PricingStage({ modelLabel, rate }: { modelLabel?: string; rate?: number | null }) {
  const set = !!modelLabel || (rate != null && rate > 0);
  return (
    <StageWindow titlebar="How you charge" status={set ? "Set" : "Draft"} statusTone={set ? "ready" : "muted"}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
        <span style={{ fontFamily: "var(--font-serif)", fontSize: 34, lineHeight: 1, letterSpacing: "-0.02em", color: rate ? "var(--foreground)" : "var(--border)" }}>
          {rate ? `$${rate}` : "$—"}
        </span>
        <span style={{ fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--muted-foreground)" }}>/ hour</span>
      </div>
      <div style={{ fontFamily: "var(--font-sans)", fontSize: 12.5, color: "var(--muted-foreground)" }}>{modelLabel || "Pick how you bill"}</div>
      <div style={divider} />
      <MetaRow label="Seeds" value="Every new quote" />
    </StageWindow>
  );
}

/* ---------- Optional client — engagement + invite ----------
   "created" is the client made without an invite: the board exists and the
   builder holds the only seat, so the seat reads unclaimed rather than sent. */
export function EngagementStage({ clientName, stage }: {
  clientName?: string; stage: "client" | "invite" | "created";
}) {
  const name = (clientName || "").trim() || "Acme Bakery";
  const { status, tone, seatState } = {
    client: { status: "New", tone: "muted" as StatusTone, seatState: "Pending" },
    invite: { status: "Invite sent", tone: "active" as StatusTone, seatState: "Invited" },
    created: { status: "On the board", tone: "ready" as StatusTone, seatState: "Not invited" },
  }[stage];
  return (
    <StageWindow titlebar="Client" status={status} statusTone={tone}>
      <div style={{ fontFamily: "var(--font-serif)", fontSize: 24, lineHeight: 1.15, letterSpacing: "-0.01em", color: "var(--foreground)", marginBottom: 3 }}>{name}</div>
      <div style={{ fontFamily: "var(--font-sans)", fontSize: 12.5, color: "var(--muted-foreground)", marginBottom: 16 }}>Shared workspace</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
        <Seat initials="YOU" name="You" role="Owner" />
        <Seat initials={initialsOf(name)} name={name} role="Operator · client" state={seatState} />
      </div>
      <div style={divider} />
      {stage === "invite" ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: "var(--surface-subtle)" }}>
          <WzIcon name="link" size={15} style={{ color: "var(--muted-foreground)", flexShrink: 0 }} />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>kroweportal.com/join/…</span>
        </div>
      ) : (
        <div style={{ fontFamily: "var(--font-sans)", fontSize: 12.5, color: "var(--muted-foreground)", fontStyle: "italic" }}>
          {stage === "created"
            ? "Invite them whenever you're ready — the board is yours until then."
            : "An invite link generates as soon as the client is created."}
        </div>
      )}
    </StageWindow>
  );
}
