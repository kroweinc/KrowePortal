"use client";

import { useEffect, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { AvatarUpload } from "@/components/builder-profile/avatar-upload";
import {
  advanceOnboarding,
  createClientEngagement,
  saveAgencyIdentity,
  saveAgencyType,
  saveAgencySize,
  saveCharging,
} from "@/lib/actions/onboarding";
import {
  AGENCY_TYPES,
  AGENCY_SIZES,
  PRICING_MODELS,
  type AgencySize,
  type AgencyType,
  type PricingModel,
} from "@/lib/types";
import {
  EditorialShell,
  WzPrimary,
  WzGhostLink,
  WzLineField,
  WzPathCard,
  WzIcon,
  WzOpening,
  type WizardNav,
} from "./wizard-shell";
import { IdentityStage, AgencyStage, PricingStage, EngagementStage } from "./wizard-stages";
import type { OnboardingBuilderProfile } from "./wizard";

const SKIP_CLIENT = "Skip — I'll add clients later";

const errStyle: CSSProperties = { margin: 0, fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--danger)" };
const groupLabel: CSSProperties = {
  fontFamily: "var(--font-sans)", fontSize: 11.5, fontWeight: 600,
  letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted-foreground)",
};

/* -------------------------------- options -------------------------------- */

const AGENCY_TYPE_OPTIONS: Record<AgencyType, { title: string; kicker: string; body: string; icon: "spark" | "globe" | "code" }> = {
  ai: { title: "AI agency", kicker: "Agents & models", body: "You build with LLMs and agents — copilots, RAG, automations, pipelines.", icon: "spark" },
  web: { title: "Web agency", kicker: "Sites & web apps", body: "You ship marketing sites and web apps — everything front-of-house.", icon: "globe" },
  software: { title: "Software agency", kicker: "Products & platforms", body: "You build custom software — platforms, APIs, and full product builds.", icon: "code" },
};

const AGENCY_SIZE_OPTIONS: Record<AgencySize, { title: string; hint: string }> = {
  solo: { title: "Just me", hint: "Solo builder" },
  "2_5": { title: "2–5 people", hint: "Small studio" },
  "6_15": { title: "6–15 people", hint: "Growing team" },
  "16_plus": { title: "16+ people", hint: "Established agency" },
};

const PRICING_MODEL_OPTIONS: Record<PricingModel, { title: string; hint: string }> = {
  hourly: { title: "Hourly", hint: "Bill by the hour" },
  fixed_bid: { title: "Fixed-bid", hint: "Price per project" },
  retainer: { title: "Retainer", hint: "Monthly recurring" },
};

/* ---------------------------- shared controls ---------------------------- */

/* Large single-select row (agency size) — card convention, radius-lg, like
   WzPathCard. Selecting saves + advances, so the check is mainly a resume cue. */
function SelectRow({ title, hint, selected, onClick, disabled }: {
  title: string; hint: string; selected: boolean; onClick: () => void; disabled?: boolean;
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
        display: "flex", alignItems: "center", gap: 14, width: "100%", textAlign: "left",
        cursor: disabled ? "default" : "pointer", padding: "15px 18px",
        background: selected ? "var(--primary-soft)" : "var(--background)",
        border: `2px solid ${selected ? "var(--primary)" : hover ? "color-mix(in oklch, var(--primary) 45%, transparent)" : "var(--border)"}`,
        borderRadius: "var(--radius-lg)",
        boxShadow: hover && !selected ? "var(--shadow-2)" : "var(--shadow-1)",
        transform: hover && !selected ? "translateY(-2px)" : "none",
        opacity: disabled && !selected ? 0.6 : 1,
        transition: "all var(--duration-fast) var(--ease-out-smooth)",
      }}
    >
      <span style={{
        width: 20, height: 20, flexShrink: 0, borderRadius: "50%",
        border: `2px solid ${selected ? "var(--primary)" : "var(--border)"}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: selected ? "var(--primary)" : "transparent", color: "#fff",
      }}>
        {selected && <WzIcon name="check" size={12} stroke={3} />}
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: "var(--font-sans)", fontSize: 15, fontWeight: 600, color: "var(--foreground)" }}>{title}</div>
        <div style={{ fontFamily: "var(--font-sans)", fontSize: 12.5, color: "var(--muted-foreground)" }}>{hint}</div>
      </div>
    </button>
  );
}

/* Compact single-select tile (pricing model) — controlled, no auto-advance. */
function ModelPill({ title, hint, selected, onClick, disabled }: {
  title: string; hint: string; selected: boolean; onClick: () => void; disabled?: boolean;
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
        flex: 1, cursor: disabled ? "default" : "pointer", textAlign: "center", padding: "14px 10px",
        background: selected ? "var(--primary-soft)" : "var(--background)",
        border: `2px solid ${selected ? "var(--primary)" : hover ? "color-mix(in oklch, var(--primary) 45%, transparent)" : "var(--border)"}`,
        borderRadius: "var(--radius-lg)",
        boxShadow: hover && !selected ? "var(--shadow-2)" : "var(--shadow-1)",
        transform: hover && !selected ? "translateY(-2px)" : "none",
        transition: "all var(--duration-fast) var(--ease-out-smooth)",
      }}
    >
      <div style={{ fontFamily: "var(--font-sans)", fontSize: 14.5, fontWeight: 600, color: selected ? "var(--primary)" : "var(--foreground)" }}>{title}</div>
      <div style={{ fontFamily: "var(--font-sans)", fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 3 }}>{hint}</div>
    </button>
  );
}

/* ------------------------------- identity -------------------------------- */

export function IdentityStep({ nav, profile }: { nav: WizardNav; profile: OnboardingBuilderProfile }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState({
    name: profile.displayName ?? "",
    agency: profile.agencyName ?? "",
    role: profile.agencyRole ?? "",
  });

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const res = await saveAgencyIdentity({
        displayName: (formData.get("display_name") as string) || undefined,
        agencyName: (formData.get("agency_name") as string) || undefined,
        agencyRole: (formData.get("agency_role") as string) || undefined,
      });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <EditorialShell
      nav={nav}
      progress={{ pathLabel: "Your account", index: 1, total: 5 }}
      title="Let's set up your identity"
      sub="This is how clients and teammates see you across the portal."
      note="You can refine any of this later in Settings."
      stageEyebrow="Your profile"
      stageHeadline="You, front and center."
      stageSub="Your name and agency show on every doc you send."
      stage={<IdentityStage name={form.name} agency={form.agency} role={form.role} avatarUrl={profile.avatarUrl} />}
    >
      <form action={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <AvatarUpload avatarUrl={profile.avatarUrl} displayName={form.name || profile.displayName || "You"} />
        <WzLineField
          label="Your name" name="display_name" defaultValue={profile.displayName ?? ""}
          placeholder="Jane Smith" required maxLength={80}
          onChange={(v) => setForm((f) => ({ ...f, name: v }))}
        />
        <WzLineField
          label="Agency or company" name="agency_name" defaultValue={profile.agencyName ?? ""}
          placeholder="Ember Studio" maxLength={120}
          onChange={(v) => setForm((f) => ({ ...f, agency: v }))}
        />
        <WzLineField
          label="Your role" optional name="agency_role" defaultValue={profile.agencyRole ?? ""}
          placeholder="Founder & lead engineer" maxLength={120}
          onChange={(v) => setForm((f) => ({ ...f, role: v }))}
        />
        {error && <p style={errStyle}>{error}</p>}
        <div style={{ marginTop: 8 }}>
          <WzPrimary type="submit" disabled={isPending}>{isPending ? "Saving…" : "Continue"}</WzPrimary>
        </div>
      </form>
    </EditorialShell>
  );
}

/* ------------------------------ agency type ------------------------------ */

export function AgencyTypeStep({ nav, selected }: { nav: WizardNav; selected: AgencyType | null }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [picked, setPicked] = useState<AgencyType | null>(selected);

  function choose(type: AgencyType) {
    setPicked(type);
    startTransition(async () => {
      await saveAgencyType(type);
      router.refresh();
    });
  }

  return (
    <EditorialShell
      nav={nav}
      progress={{ pathLabel: "Your agency", index: 2, total: 5 }}
      title="What kind of agency do you run?"
      sub="This tailors your workspace and the documents Krowe drafts for you."
      note="Pick the closest fit — you can change it in Settings anytime."
      stageEyebrow="Your agency"
      stageHeadline="Built around how you build."
      stageSub="Krowe shapes PRDs and quotes to your discipline."
      stage={<AgencyStage typeLabel={picked ? AGENCY_TYPE_OPTIONS[picked].title : undefined} />}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {AGENCY_TYPES.map((t) => {
          const o = AGENCY_TYPE_OPTIONS[t];
          return (
            <WzPathCard
              key={t}
              glyph={<WzIcon name={o.icon} size={20} />}
              kicker={o.kicker}
              title={o.title}
              body={o.body}
              onClick={() => choose(t)}
              disabled={isPending}
            />
          );
        })}
      </div>
    </EditorialShell>
  );
}

/* ------------------------------ agency size ------------------------------ */

export function AgencySizeStep({ nav, selected, priorType }: {
  nav: WizardNav; selected: AgencySize | null; priorType: AgencyType | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [picked, setPicked] = useState<AgencySize | null>(selected);

  function choose(size: AgencySize) {
    setPicked(size);
    startTransition(async () => {
      await saveAgencySize(size);
      router.refresh();
    });
  }

  return (
    <EditorialShell
      nav={nav}
      progress={{ pathLabel: "Your agency", index: 3, total: 5 }}
      title="How big is your team?"
      sub="A rough headcount is plenty — it helps us right-size your defaults."
      note="Solo today, growing tomorrow? Pick where you are right now."
      stageEyebrow="Your agency"
      stageHeadline="Sized to your shop."
      stageSub="From solo to full studio, Krowe fits."
      stage={
        <AgencyStage
          typeLabel={priorType ? AGENCY_TYPE_OPTIONS[priorType].title : undefined}
          sizeLabel={picked ? AGENCY_SIZE_OPTIONS[picked].title : undefined}
        />
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
        {AGENCY_SIZES.map((s) => {
          const o = AGENCY_SIZE_OPTIONS[s];
          return (
            <SelectRow
              key={s}
              title={o.title}
              hint={o.hint}
              selected={picked === s}
              onClick={() => choose(s)}
              disabled={isPending}
            />
          );
        })}
      </div>
    </EditorialShell>
  );
}

/* -------------------------- client (optional) ---------------------------- */

function InvitePanel({
  nav, inviteToken, clientName, onContinue, onBack, isPending,
}: {
  nav: WizardNav;
  inviteToken: string | null;
  clientName: string;
  onContinue: () => void;
  onBack: () => void;
  isPending: boolean;
}) {
  // window isn't available during SSR — this panel can render on first paint
  // when resuming the wizard, unlike a post-click panel.
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);
  const inviteUrl = inviteToken && origin ? `${origin}/join/${inviteToken}` : null;
  const display = inviteToken && origin
    ? `${origin.replace(/^https?:\/\//, "")}/join/${inviteToken}`
    : "";

  function handleCopy() {
    if (!inviteUrl) return;
    try {
      navigator.clipboard?.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable — the link is selectable in the field */
    }
  }

  return (
    <EditorialShell
      nav={nav}
      onBack={onBack}
      progress={{ pathLabel: "Your first client", index: 4, total: 5 }}
      title="Send the invite"
      sub={
        <>
          <strong style={{ color: "var(--foreground)", fontWeight: 600 }}>{clientName}</strong>{" "}
          {inviteToken
            ? "is set up. Send this link — they'll join as the operator on your shared board."
            : "is set up. Your client has already joined."}
        </>
      }
      note="One link, and they're in. No passwords to chase."
      stageEyebrow="The invite"
      stageHeadline="One link, and they're in."
      stageSub="The seat stays pending until they accept."
      stage={<EngagementStage stage="invite" clientName={clientName} />}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 380 }}>
        {inviteToken && (
          <div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={groupLabel}>Invite link</span>
              <span style={{ fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--muted-foreground)", fontStyle: "italic" }}>expires in 7 days</span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1, height: 46, display: "flex", alignItems: "center", padding: "0 13px", boxSizing: "border-box", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: "var(--surface-subtle)", fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{display}</div>
              <button
                type="button"
                onClick={handleCopy}
                style={{ flexShrink: 0, height: 46, padding: "0 16px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7, border: `1px solid ${copied ? "var(--success)" : "var(--border)"}`, borderRadius: "var(--radius-md)", background: copied ? "var(--success-soft)" : "var(--surface-subtle)", color: copied ? "var(--success)" : "var(--foreground)", fontFamily: "var(--font-sans)", fontSize: 13.5, fontWeight: 600, transition: "all var(--duration-fast) var(--ease-out-smooth)" }}
              >
                <WzIcon name={copied ? "check" : "copy"} size={15} />{copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}
        <WzPrimary onClick={onContinue} disabled={isPending}>Continue</WzPrimary>
      </div>
    </EditorialShell>
  );
}

export function ClientStep({
  nav, existing,
}: {
  nav: WizardNav;
  existing: { title: string; inviteToken: string | null } | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [namePreview, setNamePreview] = useState(existing?.title ?? "");
  const [result, setResult] = useState<{ clientName: string; inviteToken: string | null } | null>(
    existing ? { clientName: existing.title, inviteToken: existing.inviteToken } : null
  );
  const [isPending, startTransition] = useTransition();

  function toCharging() {
    startTransition(async () => {
      await advanceOnboarding("charging");
      router.refresh();
    });
  }

  function handleSubmit(formData: FormData) {
    const clientName = ((formData.get("clientName") as string) ?? "").trim();
    startTransition(async () => {
      const res = await createClientEngagement({
        clientName,
        clientEmail: (formData.get("clientEmail") as string) || undefined,
      });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setResult({ clientName, inviteToken: res.inviteToken });
    });
  }

  if (result) {
    return (
      <InvitePanel
        nav={nav}
        inviteToken={result.inviteToken}
        clientName={result.clientName}
        isPending={isPending}
        onBack={() => setResult(null)}
        onContinue={toCharging}
      />
    );
  }

  return (
    <EditorialShell
      nav={nav}
      progress={{ pathLabel: "Your first client", index: 4, total: 5 }}
      title="Do you have a client right now?"
      sub="Add them to spin up a shared board and an invite link — or skip and add clients later."
      note="They'll see exactly what you put on the board — nothing else."
      stageEyebrow="The client"
      stageHeadline="Your shared workspace."
      stageSub="One place you and your client both work from."
      stage={<EngagementStage stage="client" clientName={namePreview} />}
    >
      <form action={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <WzLineField
          label="Client or company name" name="clientName" placeholder="Acme Bakery"
          required maxLength={120} autoFocus defaultValue={existing?.title}
          onChange={(v) => setNamePreview(v)}
        />
        <WzLineField label="Client email" optional type="email" name="clientEmail" placeholder="jane@acme.com" maxLength={320} />
        {error && <p style={errStyle}>{error}</p>}
        <div style={{ marginTop: 8 }}>
          <WzPrimary type="submit" disabled={isPending}>{isPending ? "Setting up…" : "Create client & invite link"}</WzPrimary>
        </div>
        <div style={{ display: "flex", justifyContent: "center", marginTop: -6 }}>
          <WzGhostLink type="button" onClick={toCharging} disabled={isPending}>{SKIP_CLIENT}</WzGhostLink>
        </div>
      </form>
    </EditorialShell>
  );
}

/* -------------------------------- charging ------------------------------- */

export function ChargingStep({ nav, selectedModel, hourlyRate }: {
  nav: WizardNav; selectedModel: PricingModel | null; hourlyRate: number | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [model, setModel] = useState<PricingModel | null>(selectedModel);
  const [rate, setRate] = useState<string>(hourlyRate != null && hourlyRate > 0 ? String(hourlyRate) : "");
  const [splash, setSplash] = useState(false);

  function handleSubmit() {
    if (!model) {
      setError("Pick how you charge.");
      return;
    }
    const parsedRate = Number.parseInt(rate, 10);
    if (!Number.isFinite(parsedRate) || parsedRate < 0) {
      setError("Enter your typical hourly rate.");
      return;
    }
    setError(null);
    setSplash(true);
    startTransition(async () => {
      const res = await saveCharging({ pricingModel: model, hourlyRate: parsedRate });
      if ("error" in res) {
        setError(res.error);
        setSplash(false);
        return;
      }
      router.push("/b");
    });
  }

  if (splash) return <WzOpening title="You're all set" sub="Opening your workspace — let's get to work." />;

  const rateNum = rate ? Number.parseInt(rate, 10) : null;

  return (
    <EditorialShell
      nav={nav}
      progress={{ pathLabel: "How you charge", index: 5, total: 5 }}
      title="How do you charge?"
      sub="We'll seed every new quote with this — you can adjust any quote before you send it."
      note="Not sure yet? A rough number is fine; change it in Settings later."
      stageEyebrow="How you charge"
      stageHeadline="Quotes that start with your numbers."
      stageSub="Set it once; every quote prefills."
      stage={<PricingStage modelLabel={model ? PRICING_MODEL_OPTIONS[model].title : undefined} rate={Number.isFinite(rateNum) ? rateNum : null} />}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          <span style={groupLabel}>Pricing model</span>
          <div style={{ display: "flex", gap: 10 }}>
            {PRICING_MODELS.map((m) => (
              <ModelPill
                key={m}
                title={PRICING_MODEL_OPTIONS[m].title}
                hint={PRICING_MODEL_OPTIONS[m].hint}
                selected={model === m}
                onClick={() => setModel(m)}
                disabled={isPending}
              />
            ))}
          </div>
        </div>
        <WzLineField
          label="Typical hourly rate ($)" type="number" name="hourlyRate"
          value={rate} placeholder="125" onChange={setRate}
        />
        {error && <p style={errStyle}>{error}</p>}
        <div style={{ marginTop: 4 }}>
          <WzPrimary onClick={handleSubmit} disabled={isPending}>{isPending ? "Finishing…" : "Finish setup"}</WzPrimary>
        </div>
      </div>
    </EditorialShell>
  );
}
