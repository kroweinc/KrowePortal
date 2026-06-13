"use client";

import { useState, type CSSProperties, type ReactNode } from "react";

/* ============================================================
   KROWE ONBOARDING — editorial shell + primitives
   Ported from the Claude Design handoff (wizard-components.jsx).
   Pure presentational; inputs are UNCONTROLLED so the existing
   <form action> + FormData data flow is preserved untouched.
   ============================================================ */

/* ---------------------------------- nav ---------------------------------- */

export interface WizardNav {
  back: () => void;
  canBack: boolean;
  exit: () => void;
}

export interface StepProgress {
  pathLabel: string;
  index: number;
  total: number;
}

/* --------------------------------- ember --------------------------------- */

export function WzEmber({ size = 13, animated = true }: { size?: number; animated?: boolean }) {
  const breathe: CSSProperties | undefined = animated
    ? { animation: "breathe 3.6s var(--ease-out-smooth) infinite", transformOrigin: "8px 8px" }
    : undefined;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" style={{ flexShrink: 0, overflow: "visible" }} aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill="var(--primary)" opacity="0.14" />
      <circle cx="8" cy="8" r="4" fill="var(--primary)" opacity="0.4" style={breathe} />
      <circle cx="8" cy="8" r="2.5" fill="var(--primary)" />
      <circle cx="9" cy="7" r="1" fill="var(--primary-accent)" style={animated ? { ...breathe, animationDelay: "0.45s" } : undefined} />
    </svg>
  );
}

export function WzWordmark({ ember = false }: { ember?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/KroweIcon.png"
        alt=""
        aria-hidden="true"
        width={22}
        height={22}
        style={{ width: 22, height: 22, objectFit: "contain", display: "block" }}
      />
      <span style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 16, letterSpacing: "-0.01em", color: "var(--foreground)" }}>
        Krowe
      </span>
      {ember && <WzEmber size={11} />}
    </div>
  );
}

/* ---------------------------------- icons -------------------------------- */

type IconName =
  | "arrow" | "back" | "plus" | "copy" | "check" | "file" | "receipt"
  | "pen" | "board" | "folder" | "link" | "megaphone" | "users" | "git" | "dot";

export function WzIcon({ name, size = 18, stroke = 1.75, style }: { name: IconName; size?: number; stroke?: number; style?: CSSProperties }) {
  const paths: Record<IconName, ReactNode> = {
    arrow: <><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></>,
    back: <><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></>,
    plus: <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>,
    copy: <><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
    check: <><polyline points="20 6 9 17 4 12" /></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></>,
    receipt: <><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1Z" /><path d="M8 7h8" /><path d="M8 11h8" /><path d="M8 15h5" /></>,
    pen: <><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
    board: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /><path d="M15 3v18" /></>,
    folder: <><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" /></>,
    link: <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>,
    megaphone: <><path d="m3 11 18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
    git: <><circle cx="12" cy="12" r="3" /><line x1="3" y1="12" x2="9" y2="12" /><line x1="15" y1="12" x2="21" y2="12" /></>,
    dot: <><circle cx="12" cy="12" r="4" /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>
      {paths[name]}
    </svg>
  );
}

export function GitHubGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 1.5C6.2 1.5 1.5 6.3 1.5 12.2c0 4.7 3 8.7 7.2 10.1.5.1.7-.2.7-.5v-1.8c-2.9.6-3.5-1.4-3.5-1.4-.5-1.2-1.2-1.6-1.2-1.6-.9-.7.1-.7.1-.7 1 .1 1.6 1.1 1.6 1.1.9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.6-1.4-2.3-.3-4.7-1.2-4.7-5.2 0-1.2.4-2.1 1.1-2.8-.1-.3-.5-1.4.1-2.9 0 0 .9-.3 3 1.1.9-.2 1.8-.4 2.7-.4.9 0 1.8.1 2.7.4 2.1-1.4 3-1.1 3-1.1.6 1.5.2 2.6.1 2.9.7.7 1.1 1.7 1.1 2.8 0 4-2.4 4.9-4.7 5.2.4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5 4.2-1.4 7.2-5.4 7.2-10.1C22.5 6.3 17.8 1.5 12 1.5Z" />
    </svg>
  );
}

/* --------------------------------- buttons ------------------------------- */

interface BtnProps {
  children: ReactNode;
  onClick?: () => void;
  icon?: ReactNode;
  type?: "button" | "submit";
  disabled?: boolean;
  style?: CSSProperties;
}

/* Primary CTA — orange gradient pill (the one orange per screen) */
export function WzPrimary({ children, onClick, icon, type = "button", disabled, style }: BtnProps) {
  const [hover, setHover] = useState(false);
  const [press, setPress] = useState(false);
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPress(false); }}
      onMouseDown={() => setPress(true)}
      onMouseUp={() => setPress(false)}
      style={{
        width: "100%", height: 50, border: "none", cursor: disabled ? "default" : "pointer",
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9,
        fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 15, color: "#fff",
        background: "linear-gradient(135deg, var(--primary) 0%, var(--primary-accent) 100%)",
        borderRadius: "var(--radius-full)",
        opacity: disabled ? 0.6 : 1,
        boxShadow: press ? "none" : hover ? "var(--shadow-4)" : "var(--shadow-1)",
        transform: press ? "translateY(1px) scale(0.99)" : hover ? "translateY(-1px)" : "translateY(0)",
        transition: "all var(--duration-fast) var(--ease-out-smooth)", ...style,
      }}
    >
      {icon}{children}
    </button>
  );
}

export function WzSecondary({ children, onClick, icon, type = "button", disabled, style }: BtnProps) {
  const [hover, setHover] = useState(false);
  const [press, setPress] = useState(false);
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPress(false); }}
      onMouseDown={() => setPress(true)}
      onMouseUp={() => setPress(false)}
      style={{
        width: "100%", height: 48, cursor: disabled ? "default" : "pointer",
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9,
        fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: 14.5, color: "var(--foreground)",
        background: hover ? "var(--background)" : "var(--surface-subtle)",
        border: `1px solid ${hover ? "var(--primary)" : "var(--border)"}`,
        borderRadius: "var(--radius-full)", boxShadow: hover ? "var(--shadow-1)" : "none",
        opacity: disabled ? 0.6 : 1,
        transform: press ? "scale(0.99)" : "scale(1)",
        transition: "all var(--duration-fast) var(--ease-out-smooth)", ...style,
      }}
    >
      {icon}{children}
    </button>
  );
}

export function WzGhostLink({ children, onClick, type = "button", disabled, style }: BtnProps) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: "transparent", border: "none", cursor: disabled ? "default" : "pointer", padding: "6px 2px",
        fontFamily: "var(--font-sans)", fontSize: 13.5, fontWeight: 500, whiteSpace: "nowrap",
        color: hover ? "var(--foreground)" : "var(--muted-foreground)",
        opacity: disabled ? 0.6 : 1,
        transition: "color var(--duration-fast) var(--ease-out-smooth)", ...style,
      }}
    >
      {children}
    </button>
  );
}

/* ----------------------------- line field -------------------------------- */

interface LineFieldProps {
  label?: string;
  optional?: boolean;
  type?: string;
  name?: string;
  placeholder?: string;
  defaultValue?: string;
  /** Controlled read-only mode (invite-link display). */
  value?: string;
  readOnly?: boolean;
  required?: boolean;
  maxLength?: number;
  autoFocus?: boolean;
  mono?: boolean;
  /** Optional live listener — fires without making the input controlled. */
  onChange?: (value: string) => void;
}

/* Ledger-style underline input — editorial, not boxed. Uncontrolled by default. */
export function WzLineField({
  label, optional, type = "text", name, placeholder,
  defaultValue, value, readOnly, required, maxLength, autoFocus, mono, onChange,
}: LineFieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {label && (
        <label style={{ fontFamily: "var(--font-sans)", fontSize: 11.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted-foreground)" }}>
          {label}
          {optional && <span style={{ fontWeight: 500, letterSpacing: "0.04em", opacity: 0.7 }}> · optional</span>}
        </label>
      )}
      <input
        type={type}
        name={name}
        placeholder={placeholder}
        defaultValue={value === undefined ? defaultValue : undefined}
        value={value}
        readOnly={readOnly}
        required={required}
        maxLength={maxLength}
        autoFocus={autoFocus}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: "100%", padding: "7px 2px", boxSizing: "border-box",
          border: "none", borderBottom: `1.5px solid ${focused ? "var(--primary)" : "var(--border)"}`,
          borderRadius: 0, background: "transparent", boxShadow: "none",
          fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
          fontSize: mono ? 14 : 17, fontWeight: 400, color: "var(--foreground)", outline: "none",
          transition: "border-color var(--duration-fast) var(--ease-out-smooth)",
        }}
      />
    </div>
  );
}

/* ------------------------------- path card ------------------------------- */

export function WzPathCard({ glyph, kicker, title, body, onClick, disabled }: {
  glyph: ReactNode; kicker: string; title: string; body: string; onClick?: () => void; disabled?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        textAlign: "left", width: "100%", cursor: disabled ? "default" : "pointer", display: "flex", gap: 16, alignItems: "flex-start",
        background: "var(--background)",
        border: `2px solid ${hover ? "color-mix(in oklch, var(--primary) 55%, transparent)" : "var(--border)"}`,
        borderRadius: "var(--radius-lg)", padding: "18px 20px",
        opacity: disabled ? 0.6 : 1,
        boxShadow: hover ? "var(--shadow-2)" : "var(--shadow-1)",
        transform: hover ? "translateY(-2px)" : "translateY(0)",
        transition: "all var(--duration-fast) var(--ease-out-smooth)",
      }}
    >
      <div style={{
        flexShrink: 0, width: 40, height: 40, borderRadius: "var(--radius-md)",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: hover ? "var(--primary-soft)" : "var(--surface-subtle)",
        color: hover ? "var(--primary)" : "var(--foreground)", border: "1px solid var(--border)",
        transition: "all var(--duration-fast) var(--ease-out-smooth)",
      }}>
        {glyph}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: "var(--font-sans)", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted-foreground)", marginBottom: 5 }}>{kicker}</div>
        <div style={{ fontFamily: "var(--font-sans)", fontSize: 16, fontWeight: 600, color: "var(--foreground)", marginBottom: 5 }}>{title}</div>
        <div style={{ fontFamily: "var(--font-sans)", fontSize: 13, lineHeight: 1.55, color: "var(--muted-foreground)" }}>{body}</div>
      </div>
      <span style={{ marginTop: 12, color: hover ? "var(--primary)" : "var(--muted-foreground)", transform: hover ? "translateX(3px)" : "none", transition: "all var(--duration-fast) var(--ease-out-smooth)" }}>
        <WzIcon name="arrow" size={18} />
      </span>
    </button>
  );
}

/* ----------------------------- note + progress --------------------------- */

/* Advisor margin note — ember + italic */
export function WzNote({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
      <span style={{ flexShrink: 0, marginTop: 3 }}><WzEmber size={13} /></span>
      <p style={{ margin: 0, fontFamily: "var(--font-sans)", fontStyle: "italic", fontSize: 13, lineHeight: 1.55, color: "var(--muted-foreground)" }}>{children}</p>
    </div>
  );
}

/* Eyebrow + thin progress track (neutral; orange reserved for CTA) */
export function WzProgress({ pathLabel, stepIndex, stepTotal }: { pathLabel: string; stepIndex: number; stepTotal: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span style={{ fontFamily: "var(--font-sans)", fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted-foreground)" }}>{pathLabel}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, fontWeight: 500, color: "var(--muted-foreground)" }}>
          <span style={{ color: "var(--foreground)" }}>{String(stepIndex).padStart(2, "0")}</span> / {String(stepTotal).padStart(2, "0")}
        </span>
      </div>
      <div style={{ display: "flex", gap: 5 }}>
        {Array.from({ length: stepTotal }, (_, i) => (
          <span key={i} style={{
            flex: 1, height: 3, borderRadius: "var(--radius-full)",
            background: i < stepIndex ? "var(--foreground)" : "var(--border)",
            transition: "background var(--duration-slow) var(--ease-out-smooth)",
          }} />
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   EDITORIAL SHELL — sunrise stage left, worksheet right
   ============================================================ */

export interface EditorialShellProps {
  /** Omit on the pre-wizard name screen (no Back / Save & exit). */
  nav?: WizardNav;
  /** Overrides the Back handler (e.g. invite-result → back to client form). */
  onBack?: () => void;
  progress?: StepProgress;
  title: ReactNode;
  sub?: ReactNode;
  note?: ReactNode;
  children: ReactNode;
  stageEyebrow: string;
  stageHeadline: string;
  stageSub?: string;
  stage: ReactNode;
}

export function EditorialShell({
  nav, onBack, progress, title, sub, note, children,
  stageEyebrow, stageHeadline, stageSub, stage,
}: EditorialShellProps) {
  const backHandler = onBack ?? nav?.back;
  const showBack = onBack ? true : !!nav?.canBack;
  return (
    <div className="wz-shell">
      {/* LEFT (visually) — sunrise stage with the living artifact */}
      <section className="wz-right krowe-sunrise noise-surface">
        <div className="wz-stage-head"><WzWordmark /></div>
        <div className="wz-right-inner">
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <WzEmber size={14} />
            <span style={{ fontFamily: "var(--font-sans)", fontSize: 11.5, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--primary)" }}>{stageEyebrow}</span>
          </div>
          <h2 style={{ fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 38, lineHeight: 1.12, letterSpacing: "-0.02em", color: "var(--foreground)", margin: 0, maxWidth: 420 }}>{stageHeadline}</h2>
          {stageSub && <p style={{ fontFamily: "var(--font-sans)", fontSize: 14.5, lineHeight: 1.55, color: "var(--muted-foreground)", margin: "12px 0 0", maxWidth: 380 }}>{stageSub}</p>}
        </div>
        <div className="wz-stage-art">{stage}</div>
      </section>

      {/* RIGHT (visually) — worksheet */}
      <section className="wz-left">
        <div className="wz-left-head">
          <div className="wz-head-left">
            <span className="wz-brand-mobile"><WzWordmark /></span>
            {showBack
              ? <WzGhostLink onClick={backHandler} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><WzIcon name="back" size={15} /> Back</WzGhostLink>
              : <span style={{ width: 1 }} />}
          </div>
          {nav?.exit
            ? <WzGhostLink onClick={nav.exit}>Save &amp; exit</WzGhostLink>
            : <span style={{ width: 1 }} />}
        </div>

        <div className="wz-left-body">
          <div className="wz-left-inner">
            {progress ? <div style={{ marginBottom: 26 }}><WzProgress pathLabel={progress.pathLabel} stepIndex={progress.index} stepTotal={progress.total} /></div> : null}
            <h1 style={{ fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 40, lineHeight: 1.08, letterSpacing: "-0.02em", color: "var(--foreground)", margin: 0 }}>{title}</h1>
            {sub && <p style={{ fontFamily: "var(--font-sans)", fontSize: 15, lineHeight: 1.55, color: "var(--muted-foreground)", margin: "12px 0 0", maxWidth: 380 }}>{sub}</p>}
            <div style={{ marginTop: 30 }}>{children}</div>
            {note && <div style={{ marginTop: 26 }}><WzNote>{note}</WzNote></div>}
          </div>
        </div>
      </section>
    </div>
  );
}

/* ============================================================
   FULL-BLEED SUNRISE — pending "Opening…" treatment + simple
   centered layout reused by the pre-wizard name screen.
   ============================================================ */

export function WzSunriseCenter({ children }: { children: ReactNode }) {
  return (
    <div
      className="krowe-sunrise noise-surface"
      style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 24 }}
    >
      <div style={{ position: "relative", zIndex: 2, display: "flex", flexDirection: "column", alignItems: "center" }}>
        {children}
      </div>
    </div>
  );
}

export function WzOpening({ title, sub }: { title: string; sub?: string }) {
  return (
    <WzSunriseCenter>
      <div style={{ marginBottom: 22 }}><WzEmber size={48} /></div>
      <h1 style={{ fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 44, lineHeight: 1.12, letterSpacing: "-0.02em", color: "var(--foreground)", margin: 0 }}>{title}</h1>
      {sub && <p style={{ fontFamily: "var(--font-sans)", fontSize: 15.5, lineHeight: 1.55, color: "var(--muted-foreground)", margin: "12px 0 0", maxWidth: 360 }}>{sub}</p>}
    </WzSunriseCenter>
  );
}
