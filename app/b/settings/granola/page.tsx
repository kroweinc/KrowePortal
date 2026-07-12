import { redirect } from "next/navigation";
import { Info } from "lucide-react";
import { getCurrentProfile } from "@/lib/auth";
import { getGranolaConnectionStatus } from "@/lib/actions/granola";
import { ConnectGranolaForm } from "@/components/granola/connect-granola-form";
import { SettingsHeader, SettingsSection } from "@/components/settings/settings-section";

const GRANOLA_ERROR_MESSAGES: Record<string, string> = {
  granola_denied: "Granola authorization was cancelled or denied. Please try connecting again.",
  granola_token_failed: "Couldn't complete the Granola handshake. Please try connecting again.",
  granola_save_failed: "We couldn't save your Granola connection. Please try again.",
  granola_registration_failed:
    "Couldn't reach Granola to set up the connection. Please try again in a moment.",
};

export const metadata = { title: "Integrations · Settings" };

export default async function GranolaSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ granola?: string; error?: string }>;
}) {
  const params = await searchParams;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") redirect("/o");

  const status = await getGranolaConnectionStatus();

  return (
    <div className="krowe-set-stack">
      <SettingsHeader
        title="Integrations"
        sub="Connect the tools your work already lives in."
      />

      {params.granola === "connected" && (
        <div className="krowe-set-banner success">Granola connected successfully.</div>
      )}

      {params.error && (
        <div className="krowe-set-banner error">
          {GRANOLA_ERROR_MESSAGES[params.error] ??
            "Something went wrong connecting Granola. Please try again."}
        </div>
      )}

      <ConnectGranolaForm
        connected={status.connected}
        connectedAt={status.connectedAt}
        granolaEmail={status.granolaEmail}
        needsReconnect={status.needsReconnect}
      />

      <SettingsSection
        title="How it works"
        hint="Once connected, Granola shows up wherever a call would help."
      >
        <ul className="krowe-set-how-list">
          <li>
            <span className="krowe-set-how-num">1</span>
            <span>
              On a document project, use <b>Import from Granola</b> to pull a call as a
              discovery transcript — PRDs, quotes, and contracts read it automatically.
            </span>
          </li>
          <li>
            <span className="krowe-set-how-num">2</span>
            <span>
              On a client, the same import <b>drafts tasks</b>{" "}
              from the call&apos;s action items for you to review before anything is created.
            </span>
          </li>
        </ul>
        <div className="krowe-set-rule" />
        <div className="krowe-set-callout">
          <span className="ci">
            <Info size={15} strokeWidth={1.9} />
          </span>
          <span>
            More integrations are on the way. For now Granola is the only connection —
            reconnect any time your token expires.
          </span>
        </div>
      </SettingsSection>
    </div>
  );
}
