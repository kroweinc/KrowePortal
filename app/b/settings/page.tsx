import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile, DEV_PROFILE_IDS } from "@/lib/auth";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { Ember } from "@/components/design-atoms";
import { ConnectGitHubButton } from "@/components/github/connect-github-button";
import { ProfileEditor } from "@/components/settings/profile-editor";
import { PricingDefaultsEditor } from "@/components/settings/pricing-defaults-editor";
import { getPricingDefaults } from "@/lib/actions/pricing-defaults";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export const metadata = { title: "Settings" };

export default async function BuilderSettingsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") redirect("/o");

  const supabase = DEV_PROFILE_IDS.has(profile.id)
    ? createAdminClient()
    : await createClient();

  const { data: connection } = await supabase
    .from("github_connections")
    .select("github_username")
    .eq("user_id", profile.id)
    .single();

  const connected = !!connection;

  const pricingDefaults = await getPricingDefaults(profile.id);

  return (
    <main className="krowe-page">
      <div className="krowe-page-inner max-w-3xl space-y-6">
        <div className="krowe-page-head">
          <div>
            <h1 className="krowe-page-title">
              <Ember size={22} /> Settings
            </h1>
            <div className="krowe-page-sub">
              <span style={{ fontStyle: "italic", textTransform: "none", letterSpacing: "normal" }}>
                Manage your account and connections.
              </span>
            </div>
          </div>
        </div>

        <Section title="Profile" hint="How you show up across the portal.">
          <div className="space-y-4">
            <ProfileEditor initialName={profile.display_name ?? ""} />
            <dl className="grid grid-cols-2 gap-3 border-t border-neutral-100 pt-3 text-sm">
              <div>
                <dt className="text-xs text-neutral-500">Role</dt>
                <dd className="capitalize text-neutral-900">{profile.role}</dd>
              </div>
              <div>
                <dt className="text-xs text-neutral-500">Member since</dt>
                <dd className="text-neutral-900">{formatDate(profile.created_at)}</dd>
              </div>
            </dl>
          </div>
        </Section>

        <Section title="GitHub" hint="Connect your account to link repos to your clients.">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ConnectGitHubButton connected={connected} username={connection?.github_username} />
            {connected && (
              <Link
                href="/b/github/settings"
                className="text-sm text-neutral-600 underline underline-offset-2 hover:text-neutral-900"
              >
                Manage repositories
              </Link>
            )}
          </div>
        </Section>

        <Section title="Quote Defaults" hint="The base pricing every new quote starts from.">
          <PricingDefaultsEditor initial={pricingDefaults} />
        </Section>
      </div>
    </main>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
        {hint && <p className="text-xs text-neutral-500">{hint}</p>}
      </div>
      {children}
    </section>
  );
}
