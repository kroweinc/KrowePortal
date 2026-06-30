import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { AcceptInvitationForm } from "@/components/accept-invitation-form";

interface Props {
  params: Promise<{ token: string }>;
}

export const metadata = { title: "Join" };

export default async function JoinPage({ params }: Props) {
  const { token } = await params;

  // Validate token format before hitting DB
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return <ErrorCard message="This invite link is invalid." />;
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

  if (!invitation) return <ErrorCard message="This invite link is invalid." />;

  if (invitation.status === "accepted") {
    return <ErrorCard message="This invite has already been used." />;
  }

  const expired =
    invitation.status === "expired" || new Date(invitation.expires_at) < new Date();
  if (expired) {
    return <ErrorCard message="This invite has expired. Ask the builder to send a new link." />;
  }

  const engagement = invitation.engagement as unknown as {
    id: string;
    title: string;
    operator_id: string | null;
    builder: { display_name: string | null } | null;
  } | null;

  if (!engagement || engagement.operator_id) {
    return <ErrorCard message="This invite has already been used." />;
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
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
            You&apos;ve been invited
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            <span className="font-medium text-neutral-700">{builderName}</span> invited you to
            collaborate on Krowe Portal.
          </p>
        </div>

        <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm space-y-5">
          {!user ? (
            <>
              <p className="text-sm text-neutral-500">
                Sign in with Google to accept this invite and join{" "}
                <span className="font-medium text-neutral-700">{builderName}&apos;s</span> workspace.
              </p>
              <Link
                href={`/login?next=/join/${token}`}
                className="block w-full text-center rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 transition-colors"
              >
                Sign in with Google
              </Link>
            </>
          ) : (
            <>
              <p className="text-sm text-neutral-500">
                Enter your name to finish setting up your account.
              </p>
              <AcceptInvitationForm
                token={token}
                suggestedName={(user.user_metadata?.full_name as string | undefined) ?? ""}
              />
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm text-center">
        <p className="text-sm text-neutral-500">{message}</p>
        <Link href="/" className="mt-4 inline-block text-sm text-neutral-700 underline">
          Go home
        </Link>
      </div>
    </main>
  );
}
