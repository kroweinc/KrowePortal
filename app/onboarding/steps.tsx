"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RepoSelector } from "@/components/github/repo-selector";
import {
  advanceOnboarding,
  createProspectProject,
  createClientEngagement,
  finishOnboarding,
} from "@/lib/actions/onboarding";
import { createTask } from "@/lib/actions/tasks";
import type { GitHubRepo } from "@/lib/types";
import {
  EditorialShell,
  WzPrimary,
  WzSecondary,
  WzGhostLink,
  WzLineField,
  WzPathCard,
  WzIcon,
  GitHubGlyph,
  WzOpening,
  type WizardNav,
} from "./wizard-shell";
import {
  PortalTeaserStage,
  DossierStage,
  EngagementStage,
  BoardStage,
} from "./wizard-stages";

const SKIP = "Skip setup — I'll explore on my own";
const PITCH_LABEL = "Pitching · new client";
const CLIENT_LABEL = "Active client";

/* ---------------------------------- path --------------------------------- */

export function PathStep({ nav }: { nav: WizardNav }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function choose(path: "no_clients" | "has_clients") {
    startTransition(async () => {
      await advanceOnboarding(path === "no_clients" ? "prospect" : "client", path);
      router.refresh();
    });
  }

  return (
    <EditorialShell
      nav={nav}
      title="How are you starting out?"
      sub="This shapes your first steps — you can always do both later."
      note="Most people start where the money is. You can switch tracks any time."
      stageEyebrow="Welcome to Krowe"
      stageHeadline="Everything for your clients, in one calm place."
      stageSub="Pitches, engagements, code, and the shared board — they all live here."
      stage={<PortalTeaserStage />}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <WzPathCard
          glyph={<WzIcon name="megaphone" size={20} />}
          kicker="No client yet"
          title="I'm pitching new clients"
          body="Start with a PRD, quote, and contract. When they sign, it becomes a live engagement."
          onClick={() => choose("no_clients")}
          disabled={isPending}
        />
        <WzPathCard
          glyph={<WzIcon name="users" size={20} />}
          kicker="Client in hand"
          title="I already have a client"
          body="Invite them, link your repo, and start the to-do list right away. Add documents later."
          onClick={() => choose("has_clients")}
          disabled={isPending}
        />
        <div style={{ marginTop: 4 }}>
          <WzGhostLink onClick={nav.exit} disabled={isPending}>{SKIP}</WzGhostLink>
        </div>
      </div>
    </EditorialShell>
  );
}

/* ----------------------------- prospect (P1) ------------------------------ */

export function ProspectStep({ nav }: { nav: WizardNav }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [preview, setPreview] = useState({ projectName: "", contactName: "", contactEmail: "", website: "" });

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const res = await createProspectProject({
        name: (formData.get("name") as string) ?? "",
        prospectName: (formData.get("prospectName") as string) || undefined,
        prospectEmail: (formData.get("prospectEmail") as string) || undefined,
        websiteUrl: (formData.get("websiteUrl") as string) || undefined,
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
      progress={{ pathLabel: PITCH_LABEL, index: 2, total: 3 }}
      title="Who are you pitching?"
      sub="We'll set up a project to hold the PRD, quote, and contract."
      note={'Be specific — "Acme Bakery website" beats "a new project".'}
      stageEyebrow="The project"
      stageHeadline="Your pitch, taking shape."
      stageSub="This becomes the home for everything you send them."
      stage={<DossierStage stage="pitch" {...preview} />}
    >
      <form action={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <WzLineField
          label="Business or project name" name="name" placeholder="Acme Bakery website"
          required maxLength={200} autoFocus
          onChange={(v) => setPreview((p) => ({ ...p, projectName: v }))}
        />
        <WzLineField
          label="Contact name" optional name="prospectName" placeholder="Jane Smith" maxLength={200}
          onChange={(v) => setPreview((p) => ({ ...p, contactName: v }))}
        />
        <WzLineField
          label="Contact email" optional type="email" name="prospectEmail" placeholder="jane@acme.com" maxLength={320}
          onChange={(v) => setPreview((p) => ({ ...p, contactEmail: v }))}
        />
        <WzLineField
          label="Website" optional name="websiteUrl" placeholder="acme.com" maxLength={2000}
          onChange={(v) => setPreview((p) => ({ ...p, website: v }))}
        />
        {error && <p style={{ margin: 0, fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--danger)" }}>{error}</p>}
        <div style={{ marginTop: 8 }}>
          <WzPrimary type="submit" disabled={isPending}>{isPending ? "Creating…" : "Create project"}</WzPrimary>
        </div>
        <div style={{ display: "flex", justifyContent: "center", marginTop: -6 }}>
          <WzGhostLink onClick={nav.exit} disabled={isPending}>I&apos;ll set this up later</WzGhostLink>
        </div>
      </form>
    </EditorialShell>
  );
}

/* ------------------------------ handoff (P1) ------------------------------ */

export function HandoffStep({ nav, project }: { nav: WizardNav; project: { id: string; name: string } }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [splash, setSplash] = useState<{ title: string; sub: string } | null>(null);

  function go(href: string, copy: { title: string; sub: string }) {
    setSplash(copy);
    startTransition(async () => {
      await finishOnboarding("completed");
      router.push(href);
    });
  }

  if (splash) return <WzOpening title={splash.title} sub={splash.sub} />;

  return (
    <EditorialShell
      nav={nav}
      progress={{ pathLabel: PITCH_LABEL, index: 3, total: 3 }}
      title="You're all set."
      sub={
        <>
          <strong style={{ color: "var(--foreground)", fontWeight: 600 }}>{project.name}</strong>{" "}
          is ready. Your pipeline starts with the PRD — from there you&apos;ll quote it, get the
          contract signed, and begin the engagement.
        </>
      }
      note="The PRD is your anchor. Everything else quotes from it."
      stageEyebrow="The pipeline"
      stageHeadline="From brief to signed."
      stageSub="Each step unlocks the next. No empty dashboards to fill."
      stage={<DossierStage stage="allset" projectName={project.name} />}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 11, maxWidth: 360 }}>
        <WzPrimary
          icon={<WzIcon name="pen" size={16} />}
          disabled={isPending}
          onClick={() => go(`/b/projects/${project.id}/prd/new`, { title: "Opening the PRD editor", sub: "Let’s draft the brief — a sentence or two per section is plenty." })}
        >
          Write the PRD
        </WzPrimary>
        <WzSecondary
          icon={<WzIcon name="folder" size={16} />}
          disabled={isPending}
          onClick={() => go(`/b/projects/${project.id}`, { title: "Opening your project", sub: "Everything for this engagement lives here." })}
        >
          View the project
        </WzSecondary>
      </div>
    </EditorialShell>
  );
}

/* ------------------------------- client (P2) ------------------------------ */

function InvitePanel({
  nav,
  inviteToken,
  clientName,
  onContinue,
  onBack,
  isPending,
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
      progress={{ pathLabel: CLIENT_LABEL, index: 2, total: 5 }}
      title="Send the invite"
      sub={
        <>
          <strong style={{ color: "var(--foreground)", fontWeight: 600 }}>{clientName}</strong>{" "}
          {inviteToken
            ? "is set up. Send this link — they'll join as the operator on your shared board."
            : "is set up. Your client has already joined this engagement."}
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
              <span style={{ fontFamily: "var(--font-sans)", fontSize: 11.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted-foreground)" }}>Invite link</span>
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
  nav,
  existing,
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
        onContinue={() =>
          startTransition(async () => {
            // Idempotent — createClientEngagement already set step to "repo",
            // but resume can land here with the DB still on "client".
            await advanceOnboarding("repo");
            router.refresh();
          })
        }
      />
    );
  }

  return (
    <EditorialShell
      nav={nav}
      progress={{ pathLabel: CLIENT_LABEL, index: 1, total: 5 }}
      title="Set up your client"
      sub="We'll create your engagement and an invite link to share."
      note="They'll see exactly what you put on the board — nothing else."
      stageEyebrow="The engagement"
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
        {error && <p style={{ margin: 0, fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--danger)" }}>{error}</p>}
        <div style={{ marginTop: 8 }}>
          <WzPrimary type="submit" disabled={isPending}>{isPending ? "Setting up…" : "Create engagement & invite link"}</WzPrimary>
        </div>
        <div style={{ display: "flex", justifyContent: "center", marginTop: -6 }}>
          <WzGhostLink onClick={nav.exit} disabled={isPending}>{SKIP}</WzGhostLink>
        </div>
      </form>
    </EditorialShell>
  );
}

/* -------------------------------- repo (P2) ------------------------------- */

export function RepoStep({
  nav,
  connected,
  repos,
  engagement,
  clientName,
  oauthError,
}: {
  nav: WizardNav;
  connected: boolean;
  repos: GitHubRepo[];
  engagement: { id: string; repoFullName: string | null } | null;
  clientName?: string;
  oauthError?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function next() {
    startTransition(async () => {
      await advanceOnboarding("tasks");
      router.refresh();
    });
  }

  return (
    <EditorialShell
      nav={nav}
      progress={{ pathLabel: CLIENT_LABEL, index: 3, total: 5 }}
      title="Link your repository"
      sub="Connect the code you'll be working in. Krowe ties commits to this engagement."
      note="Linked once, your client watches progress without ever asking."
      stageEyebrow="The codebase"
      stageHeadline="Progress, straight from the source."
      stageSub="Commits flow onto the board your client already sees."
      stage={<BoardStage stage="repo" clientName={clientName} />}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 380 }}>
        {oauthError && (
          <p style={{ margin: 0, borderRadius: "var(--radius-md)", background: "var(--danger-soft)", padding: "9px 12px", fontFamily: "var(--font-sans)", fontSize: 12.5, color: "var(--danger)" }}>
            GitHub connection failed — you can try again or skip this for now.
          </p>
        )}
        {!connected ? (
          <WzPrimary
            icon={<GitHubGlyph size={17} />}
            onClick={() => {
              window.location.href = "/api/github/connect?returnTo=/onboarding";
            }}
          >
            Connect GitHub
          </WzPrimary>
        ) : (
          <>
            <RepoSelector
              engagementId={engagement?.id}
              currentRepo={engagement?.repoFullName}
              initialRepos={repos}
            />
            <WzPrimary onClick={next} disabled={isPending}>Continue</WzPrimary>
          </>
        )}
        <div style={{ display: "flex", justifyContent: "center" }}>
          <WzGhostLink onClick={next} disabled={isPending}>Skip for now</WzGhostLink>
        </div>
      </div>
    </EditorialShell>
  );
}

/* ------------------------------- tasks (P2) ------------------------------- */

export function TasksStep({ nav, engagementId, clientName }: { nav: WizardNav; engagementId: string | null; clientName?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [tasks, setTasks] = useState<string[]>(["", "", ""]);

  function next() {
    startTransition(async () => {
      await advanceOnboarding("docs");
      router.refresh();
    });
  }

  function handleSubmit(formData: FormData) {
    const titles = ["task1", "task2", "task3"]
      .map((k) => ((formData.get(k) as string) ?? "").trim())
      .filter(Boolean);
    if (titles.length === 0) {
      next();
      return;
    }
    startTransition(async () => {
      for (const title of titles) {
        const fd = new FormData();
        fd.set("title", title);
        if (engagementId) fd.set("engagement_id", engagementId);
        const res = await createTask(fd);
        if (res && "error" in res && res.error) {
          setError(res.error);
          return;
        }
      }
      await advanceOnboarding("docs");
      router.refresh();
    });
  }

  const placeholders = ["Set up staging environment", "Design the landing page", "Migrate the database"];

  return (
    <EditorialShell
      nav={nav}
      progress={{ pathLabel: CLIENT_LABEL, index: 4, total: 5 }}
      title="Start your to-do list"
      sub="What are you working on first? These land on the shared task board."
      note="Don't overthink it. Three things you'll do this week is plenty."
      stageEyebrow="The board"
      stageHeadline="Work, where you both can see it."
      stageSub="Tasks you add here show up live in the To do column."
      stage={<BoardStage stage="todos" clientName={clientName} tasks={tasks} />}
    >
      <form action={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 380 }}>
        {placeholders.map((ph, i) => (
          <WzLineField
            key={i}
            label={`Task ${i + 1}${i > 0 ? " · optional" : ""}`}
            name={`task${i + 1}`}
            placeholder={`e.g. ${ph}`}
            maxLength={300}
            autoFocus={i === 0}
            onChange={(v) => setTasks((t) => { const next = [...t]; next[i] = v; return next; })}
          />
        ))}
        {error && <p style={{ margin: 0, fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--danger)" }}>{error}</p>}
        <div style={{ marginTop: 8 }}>
          <WzPrimary type="submit" icon={<WzIcon name="plus" size={16} />} disabled={isPending}>
            {isPending ? "Adding…" : "Add tasks"}
          </WzPrimary>
        </div>
        <div style={{ display: "flex", justifyContent: "center", marginTop: -6 }}>
          <WzGhostLink type="button" onClick={next} disabled={isPending}>Skip for now</WzGhostLink>
        </div>
      </form>
    </EditorialShell>
  );
}

/* -------------------------------- docs (P2) ------------------------------- */

export function DocsStep({
  nav,
  projectId,
  engagementId,
  clientName,
}: {
  nav: WizardNav;
  projectId: string | null;
  engagementId: string | null;
  clientName?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [splash, setSplash] = useState<{ title: string; sub: string } | null>(null);

  function go(href: string, copy: { title: string; sub: string }) {
    setSplash(copy);
    startTransition(async () => {
      await finishOnboarding("completed");
      router.push(href);
    });
  }

  const boardHref = engagementId ? `/b?engagement=${engagementId}` : "/b";

  if (splash) return <WzOpening title={splash.title} sub={splash.sub} />;

  return (
    <EditorialShell
      nav={nav}
      progress={{ pathLabel: CLIENT_LABEL, index: 5, total: 5 }}
      title="One last thing"
      sub="Documents are optional — add them now, or anytime later from Documents."
      note="Skip these if you're mid-engagement. Add them when a client asks."
      stageEyebrow="The documents"
      stageHeadline="Paperwork, only when you need it."
      stageSub="A PRD, quote, or contract — each one starts from what's already here."
      stage={<BoardStage stage="docs" clientName={clientName} />}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 360 }}>
        {projectId && (
          <>
            <WzSecondary
              icon={<WzIcon name="file" size={16} />}
              disabled={isPending}
              onClick={() => go(`/b/projects/${projectId}/prd/new`, { title: "Opening the PRD editor", sub: "Let’s draft the brief — a sentence or two per section is plenty." })}
            >
              Write a PRD
            </WzSecondary>
            <WzSecondary
              icon={<WzIcon name="receipt" size={16} />}
              disabled={isPending}
              onClick={() => go(`/b/projects/${projectId}/quotes/new`, { title: "Starting a quote", sub: "We’ll turn the PRD into line items you can adjust." })}
            >
              Create a quote
            </WzSecondary>
            <WzSecondary
              icon={<WzIcon name="pen" size={16} />}
              disabled={isPending}
              onClick={() => go(`/b/projects/${projectId}/contract/new`, { title: "Drafting the contract", sub: "A simple agreement, ready for signature." })}
            >
              Draft a contract
            </WzSecondary>
          </>
        )}
        <div style={{ marginTop: 6 }}>
          <WzPrimary
            icon={<WzIcon name="board" size={16} />}
            disabled={isPending}
            onClick={() => go(boardHref, { title: "Opening your task board", sub: "Your tasks are on the shared board — let’s get to work." })}
          >
            Go to my task board
          </WzPrimary>
        </div>
      </div>
    </EditorialShell>
  );
}
