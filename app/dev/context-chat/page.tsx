// ============================================================================
// ⚠️  TEMPORARY / THROWAWAY — NOT part of any real flow.
//
// A basic chatbot page to "talk to" a client's Context Layer for testing the
// retrieval + agent loop. Posts to /api/dev/context-query (POST = chat). Pairs
// with that route — delete both together once the real agent flow lands.
//
// Hard-gated: 404s unless DEV_TOGGLE_ENABLED and the viewer is a builder.
// Open at /dev/context-chat while logged in (dev-builder role is fine).
// ============================================================================

import { notFound } from "next/navigation";
import { DEV_TOGGLE_ENABLED, getCurrentProfile } from "@/lib/auth";
import ContextChat from "./context-chat";

export const metadata = { title: "Context Chat (dev)" };

export default async function ContextChatPage() {
  if (!DEV_TOGGLE_ENABLED) notFound();
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "builder") notFound();

  // Prefilled with the one engagement that currently has embedded context
  // (Patel Internal); editable in the UI.
  return <ContextChat defaultEngagementId="a64db420-68c8-4cb3-9f6b-2157243adb12" />;
}
