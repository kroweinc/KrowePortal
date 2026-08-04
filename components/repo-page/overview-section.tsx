import { FileText, Hand, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ProjectProfile } from "@/lib/actions/generate-project-profile";
import { SectionHead } from "./section-head";

/**
 * Split a generated paragraph into bullet lines. The AI profile stores summary
 * and audience as prose, but the design reads them as lists — so break on
 * sentence ends and semicolons and drop the trailing period. A paragraph that
 * won't split stays one bullet rather than being chopped mid-thought.
 */
function toBullets(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])|;\s+/)
    .map((s) => s.trim().replace(/[.]$/, ""))
    .filter(Boolean);
}

function OverviewCard({
  icon: Icon,
  title,
  items,
}: {
  icon: LucideIcon;
  title: string;
  items: string[];
}) {
  return (
    <section className="krowe-repo-card krowe-repo-overview-card">
      <div className="krowe-repo-card-head">
        <Icon size={13} strokeWidth={2} aria-hidden />
        <h3 className="krowe-repo-card-title">{title}</h3>
      </div>
      {items.length > 0 ? (
        <ul className="krowe-repo-bullets">
          {items.map((item, i) => (
            <li key={i}>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="krowe-repo-bullets">Not enough signal in this repo yet.</p>
      )}
    </section>
  );
}

export async function OverviewSection({
  profilePromise,
}: {
  profilePromise: Promise<ProjectProfile | null>;
}) {
  const profile = await profilePromise;

  return (
    <div className="krowe-repo-section">
      <SectionHead icon={FileText} title="Overview" />
      <div className="krowe-repo-overview">
        <OverviewCard icon={FileText} title="Summary" items={toBullets(profile?.summary)} />
        <OverviewCard icon={User} title="Stakeholders" items={toBullets(profile?.audience)} />
        <OverviewCard icon={Hand} title="Function" items={profile?.features ?? []} />
      </div>
    </div>
  );
}

export function OverviewSectionSkeleton() {
  return (
    <div className="krowe-repo-section">
      <SectionHead icon={FileText} title="Overview" />
      <div className="krowe-repo-overview">
        {[FileText, User, Hand].map((Icon, i) => (
          <section key={i} className="krowe-repo-card krowe-repo-overview-card">
            <div className="krowe-repo-card-head">
              <Icon size={13} strokeWidth={2} aria-hidden />
              <h3 className="krowe-repo-card-title">
                {["Summary", "Stakeholders", "Function"][i]}
              </h3>
            </div>
            <ul className="krowe-repo-bullets">
              {Array.from({ length: 4 }).map((_, j) => (
                <li key={j}>
                  <span
                    className="krowe-skel"
                    style={{ width: `${88 - j * 11}%`, height: 10, borderRadius: 5 }}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
