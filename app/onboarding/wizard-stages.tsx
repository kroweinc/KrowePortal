"use client";

import type { CSSProperties, ReactNode } from "react";
import { WzIcon, GitHubGlyph } from "./wizard-shell";
import { BrandLogo } from "@/components/prd/brand-logo";

/* ============================================================
   LIVING ARTIFACT PREVIEWS — assemble on the sunrise stage.
   Ported from the Claude Design handoff (wizard-previews.jsx).
   Neutral palette (the orange is reserved for the left CTA).
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

function MetaRow({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
      <span style={{ fontFamily: "var(--font-sans)", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted-foreground)" }}>{label}</span>
      <span style={{ fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)", fontSize: 13.5, color: value ? "var(--foreground)" : "var(--border)", fontWeight: value ? 500 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 230 }}>{value || "—"}</span>
    </div>
  );
}

type PipelineState = "done" | "next" | "queued";

function PipelineStep({ n, label, state }: { n: string; label: string; state: PipelineState }) {
  const active = state === "next";
  const done = state === "done";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11, opacity: state === "queued" ? 0.55 : 1 }}>
      <span style={{
        width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 600,
        border: `1.5px solid ${active ? "var(--foreground)" : "var(--border)"}`,
        background: done ? "var(--foreground)" : active ? "color-mix(in oklch, var(--foreground) 8%, transparent)" : "transparent",
        color: done ? "var(--background)" : active ? "var(--foreground)" : "var(--muted-foreground)",
      }}>{done ? <WzIcon name="check" size={11} stroke={3} /> : n}</span>
      <span style={{ flex: 1, fontFamily: "var(--font-sans)", fontSize: 13.5, fontWeight: active ? 600 : 500, color: "var(--foreground)" }}>{label}</span>
      {active && <span style={{ fontFamily: "var(--font-sans)", fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--muted-foreground)" }}>Up next</span>}
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

function TaskCard({ text, ghost }: { text: string; ghost?: boolean }) {
  return (
    <div style={{
      padding: "9px 11px", borderRadius: "var(--radius-md)",
      border: `1px ${ghost ? "dashed" : "solid"} var(--border)`,
      background: ghost ? "transparent" : "var(--background)",
      boxShadow: ghost ? "none" : "var(--shadow-1)",
      fontFamily: "var(--font-sans)", fontSize: 12.5, lineHeight: 1.35,
      color: ghost ? "var(--muted-foreground)" : "var(--foreground)",
      fontStyle: ghost ? "italic" : "normal",
    }}>{text}</div>
  );
}

const divider: CSSProperties = { height: 1, background: "var(--border)", margin: "16px 0" };

/* ---------- Fork — what they're signing into ---------- */
export function PortalTeaserStage() {
  const rows = [
    { n: "Acme Bakery", m: "PRD · Quote signed", t: "Active" },
    { n: "Northwind app rebuild", m: "Contract out for signature", t: "Pitch" },
    { n: "Harbor coffee subscription", m: "Board · 6 open tasks", t: "Active" },
  ];
  return (
    <StageWindow titlebar="Krowe · Home" status="3 engagements" statusTone="ready" width={470}>
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

/* ---------- Pitching path — project dossier ---------- */
export function DossierStage({ projectName, contactName, contactEmail, website, stage }: {
  projectName?: string; contactName?: string; contactEmail?: string; website?: string; stage: "pitch" | "allset";
}) {
  const name = (projectName || "").trim() || "Acme Bakery website";
  const ready = stage === "allset";
  // Brand mark, only once the website looks like a real domain (has a TLD) — so
  // partial typing ("acme") doesn't flash a generic globe before it resolves.
  const site = (website || "").trim();
  const hasLink = /\.[a-z]{2,}/i.test(site.replace(/^https?:\/\//i, ""));
  return (
    <StageWindow titlebar="Project" status={ready ? "Ready" : "Draft"} statusTone={ready ? "ready" : "muted"}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        {hasLink && <BrandLogo domain={site} name={name} size={40} />}
        <div style={{ fontFamily: "var(--font-serif)", fontSize: 24, lineHeight: 1.15, letterSpacing: "-0.01em", color: "var(--foreground)" }}>{name}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <MetaRow label="Contact" value={(contactName || "").trim()} />
        <MetaRow label="Email" value={(contactEmail || "").trim()} mono />
        <MetaRow label="Website" value={(website || "").trim()} mono />
      </div>
      <div style={divider} />
      <div style={{ fontFamily: "var(--font-sans)", fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--muted-foreground)", marginBottom: 13 }}>Pipeline</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
        <PipelineStep n="1" label="Product requirements (PRD)" state={ready ? "next" : "queued"} />
        <PipelineStep n="2" label="Quote" state="queued" />
        <PipelineStep n="3" label="Contract" state="queued" />
        <PipelineStep n="4" label="Live engagement" state="queued" />
      </div>
    </StageWindow>
  );
}

/* ---------- Client path — engagement + invite ---------- */
export function EngagementStage({ clientName, stage }: { clientName?: string; stage: "client" | "invite" }) {
  const name = (clientName || "").trim() || "Acme Bakery";
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const invited = stage === "invite";
  return (
    <StageWindow titlebar="Engagement" status={invited ? "Invite sent" : "New"} statusTone={invited ? "active" : "muted"}>
      <div style={{ fontFamily: "var(--font-serif)", fontSize: 24, lineHeight: 1.15, letterSpacing: "-0.01em", color: "var(--foreground)", marginBottom: 3 }}>{name}</div>
      <div style={{ fontFamily: "var(--font-sans)", fontSize: 12.5, color: "var(--muted-foreground)", marginBottom: 16 }}>Shared workspace</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
        <Seat initials="YOU" name="You" role="Owner" />
        <Seat initials={initials} name={name} role="Operator · client" state={invited ? "Invited" : "Pending"} />
      </div>
      <div style={divider} />
      {invited ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: "var(--surface-subtle)" }}>
          <WzIcon name="link" size={15} style={{ color: "var(--muted-foreground)", flexShrink: 0 }} />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>kroweportal.com/join/…</span>
        </div>
      ) : (
        <div style={{ fontFamily: "var(--font-sans)", fontSize: 12.5, color: "var(--muted-foreground)", fontStyle: "italic" }}>An invite link generates as soon as the engagement is created.</div>
      )}
    </StageWindow>
  );
}

/* ---------- Client path — shared board (repo / todos / docs) ---------- */
export function BoardStage({ clientName, tasks, stage }: {
  clientName?: string; tasks?: string[]; stage: "repo" | "todos" | "docs";
}) {
  const name = (clientName || "").trim() || "Acme Bakery";
  const live = (tasks || []).filter((t) => t && t.trim());
  const todo = stage === "todos" && live.length
    ? live.map((t) => ({ text: t }))
    : [{ text: "Set up staging environment" }, { text: "Design the landing page" }];
  const columns = [
    { title: "To do", cards: todo, count: stage === "todos" ? live.length : todo.length },
    { title: "Doing", cards: [] as { text: string }[], count: 0 },
    { title: "Done", cards: [] as { text: string }[], count: 0 },
  ];
  return (
    <StageWindow titlebar={`Board · ${name}`} status="Live" statusTone="active" width={478}>
      {(stage === "repo" || stage === "docs") && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: "var(--surface-subtle)", marginBottom: 14 }}>
          <span style={{ color: "var(--foreground)" }}><GitHubGlyph size={15} /></span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--foreground)" }}>acme/website</span>
          <span style={{ marginLeft: "auto", fontFamily: "var(--font-sans)", fontSize: 11, color: "var(--muted-foreground)" }}>{stage === "repo" ? "ready to link" : "linked · 3 commits"}</span>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        {columns.map((col, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontFamily: "var(--font-sans)", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted-foreground)" }}>{col.title}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--muted-foreground)" }}>{col.count}</span>
            </div>
            {col.cards.length
              ? col.cards.map((c, j) => <TaskCard key={j} text={c.text} />)
              : <div style={{ height: 52, borderRadius: "var(--radius-md)", border: "1px dashed var(--border)" }} />}
          </div>
        ))}
      </div>
      {stage === "docs" && (
        <>
          <div style={{ height: 1, background: "var(--border)", margin: "16px 0 13px" }} />
          <div style={{ fontFamily: "var(--font-sans)", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--muted-foreground)", marginBottom: 10 }}>Documents · optional</div>
          <div style={{ display: "flex", gap: 8 }}>
            {["PRD", "Quote", "Contract"].map((d) => (
              <span key={d} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--muted-foreground)", border: "1px dashed var(--border)", borderRadius: "var(--radius-full)", padding: "5px 12px" }}>
                <WzIcon name="plus" size={12} />{d}
              </span>
            ))}
          </div>
        </>
      )}
    </StageWindow>
  );
}
