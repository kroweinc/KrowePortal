import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { getGranolaMeeting } from "@/lib/actions/granola-meetings";
import { MeetingView } from "@/components/granola/meeting-view";

export const metadata = { title: "Meeting" };

export default async function BuilderMeetingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  // `from` is the task you clicked "From meeting" on — it marks that task's row
  // and lands you on the transcript line it was drafted from.
  searchParams: Promise<{ from?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  // app/b/layout.tsx already gates the subtree; this mirrors the sibling pages.
  if (profile.role !== "builder") redirect("/o");

  const [{ id }, { from }] = await Promise.all([params, searchParams]);
  const meeting = await getGranolaMeeting(id);
  if (!meeting) notFound();

  return <MeetingView meeting={meeting} fromTaskId={from ?? null} />;
}
