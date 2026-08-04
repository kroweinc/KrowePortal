import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { AcceptInvitationForm } from "@/components/accept-invitation-form";
import { TrustLine, Wordmark } from "@/app/login/portal-preview";

interface Props {
  params: Promise<{ token: string }>;
}

export const metadata = { title: "Join" };

export default async function JoinPage({ params }: Props) {
  const { token } = await params;

  // Validate token format before hitting DB
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return (
      <JoinShell eyebrow="Invite" headline="This link isn't valid">
        <Body>
          Double-check the link you were sent — or ask your builder to send a fresh one.
        </Body>
        <SignInLink />
      </JoinShell>
    );
  }

  // Look up invitation via admin client — the visitor may have no profile yet,
  // so RLS would block a normal client from reading the invitation row.
  const admin = createAdminClient();
  const { data: invitation } = await admin
    .from("invitations")
    .select(
      "id, status, expires_at, engagement:engagements(id, title, operator_id, builder:profiles!builder_id(display_name))"
    )
    .eq("token", token)
    .maybeSingle();

  if (!invitation) {
    return (
      <JoinShell eyebrow="Invite" headline="This link isn't valid">
        <Body>
          Double-check the link you were sent — or ask your builder to send a fresh one.
        </Body>
        <SignInLink />
      </JoinShell>
    );
  }

  if (invitation.status === "accepted") {
    return (
      <JoinShell eyebrow="Invite" headline="This invite is already used">
        <Body>Someone has already joined with this link. If that was you, sign in to pick up where you left off.</Body>
        <SignInLink label="Sign in to your board" />
      </JoinShell>
    );
  }

  const expired =
    invitation.status === "expired" || new Date(invitation.expires_at) < new Date();
  if (expired) {
    return (
      <JoinShell eyebrow="Invite" headline="This invite has expired">
        <Body>Invite links last seven days. Ask your builder to send a new one and you&apos;ll be in.</Body>
        <SignInLink />
      </JoinShell>
    );
  }

  const engagement = invitation.engagement as unknown as {
    id: string;
    title: string;
    operator_id: string | null;
    builder: { display_name: string | null } | null;
  } | null;

  if (!engagement || engagement.operator_id) {
    return (
      <JoinShell eyebrow="Invite" headline="This invite is already used">
        <Body>Someone has already joined with this link. If that was you, sign in to pick up where you left off.</Body>
        <SignInLink label="Sign in to your board" />
      </JoinShell>
    );
  }

  const builderName = engagement.builder?.display_name ?? "A builder";

  // Check auth state and existing profile
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If already an operator, send straight to the operator dashboard
  if (user) {
    const { data: existingProfile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (existingProfile?.role === "operator") {
      redirect("/o");
    }
  }

  return (
    <JoinShell eyebrow="You've been invited" headline={`Join ${builderName} on Krowe`}>
      {!user ? (
        <>
          <Body>
            <Strong>{builderName}</Strong>{" "}
            set up a shared board for your work together. Sign in — or create an account — to
            take your seat.
          </Body>
          <Link
            href={`/login?next=/join/${token}`}
            className="mt-6 flex h-[46px] w-full items-center justify-center rounded-[var(--radius-full)] bg-[var(--primary)] text-[14.5px] font-semibold text-[var(--primary-foreground)] transition-[background-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-out-smooth)] hover:bg-[var(--primary-hover)] hover:shadow-[var(--shadow-1)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color-mix(in_srgb,var(--primary)_25%,transparent)]"
          >
            Sign in to accept
          </Link>
        </>
      ) : (
        <>
          <Body>
            <Strong>{builderName}</Strong>{" "}
            set up a shared board for your work together. Add your name and it&apos;s yours.
          </Body>
          <AcceptInvitationForm
            token={token}
            suggestedName={(user.user_metadata?.full_name as string | undefined) ?? ""}
          />
        </>
      )}
    </JoinShell>
  );
}

/* The one shell every state of this page renders into — invite, expired, spent,
   malformed. Public surface, so it carries the brand the way /login does:
   Sunrise Wash behind a single tokenized card. */
function JoinShell({
  eyebrow,
  headline,
  children,
}: {
  eyebrow: string;
  headline: string;
  children: React.ReactNode;
}) {
  return (
    <main className="krowe-sunrise flex min-h-screen flex-col items-center justify-center px-[clamp(1.25rem,5vw,2rem)] py-12">
      <div className="w-full max-w-[400px]">
        <div className="mb-7 flex justify-center">
          <Wordmark />
        </div>

        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--background)] p-[clamp(1.5rem,4vw,2rem)] shadow-[var(--shadow-1)]">
          <p
            className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: "var(--primary)", fontFamily: "var(--font-sans)" }}
          >
            {eyebrow}
          </p>
          <h1
            className="text-[clamp(1.6rem,4vw,1.95rem)] leading-[1.15]"
            style={{
              fontFamily: "var(--font-serif)",
              color: "var(--foreground)",
              letterSpacing: "-0.01em",
            }}
          >
            {headline}
          </h1>
          {children}
        </div>

        <div className="mt-7 flex justify-center">
          <TrustLine />
        </div>
      </div>
    </main>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="mt-3 text-[0.95rem] leading-relaxed"
      style={{ color: "var(--muted-foreground)", fontFamily: "var(--font-sans)" }}
    >
      {children}
    </p>
  );
}

function Strong({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ color: "var(--foreground)", fontWeight: 600 }}>{children}</span>
  );
}

function SignInLink({ label = "Go to sign in" }: { label?: string }) {
  return (
    <Link
      href="/login"
      className="mt-6 flex h-[46px] w-full items-center justify-center rounded-[var(--radius-full)] border border-[var(--border)] bg-[var(--background)] text-[14.5px] font-medium text-[var(--foreground)] transition-[border-color,box-shadow,background-color] duration-[var(--duration-fast)] ease-[var(--ease-out-smooth)] hover:bg-[var(--surface-subtle)] hover:shadow-[var(--shadow-1)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color-mix(in_srgb,var(--primary)_25%,transparent)]"
    >
      {label}
    </Link>
  );
}
