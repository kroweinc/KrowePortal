import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { PENDING_INVITE_COOKIE } from "@/lib/auth-shared";
import { validatePendingInvite } from "@/lib/invitations";

export default async function RootPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    const cookieStore = await cookies();
    const inviteToken = cookieStore.get(PENDING_INVITE_COOKIE)?.value;
    const validToken = await validatePendingInvite(inviteToken);
    if (validToken) {
      redirect(`/join/${validToken}`);
    }
    redirect("/onboarding");
  }

  if (profile.role === "operator") {
    redirect("/o");
  }

  redirect("/b");
}
