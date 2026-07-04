import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { getPricingDefaults } from "@/lib/actions/pricing-defaults";
import { PricingDefaultsEditor } from "@/components/settings/pricing-defaults-editor";
import { SettingsHeader, SettingsSection } from "@/components/settings/settings-section";

export const metadata = { title: "Quote Defaults · Settings" };

export default async function BuilderQuotesPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") redirect("/o");

  const pricingDefaults = await getPricingDefaults(profile.id);

  return (
    <div className="krowe-set-stack">
      <SettingsHeader title="Quote Defaults" sub="The base pricing every new quote starts from." />
      <SettingsSection title="Pricing" hint="New quotes are seeded from these values — you can still tweak each quote.">
        <PricingDefaultsEditor initial={pricingDefaults} />
      </SettingsSection>
    </div>
  );
}
