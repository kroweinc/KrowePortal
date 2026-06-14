import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { EngagementLogo } from "./engagement-logo";
import { EngagementStatus, type EngagementStatusKind } from "./engagement-status";
import { RepoChip } from "./repo-chip";
import { initialsFrom } from "./util";
import "./engagement.css";

/* One engagement row in the list. The whole card is a single link to the Manage
   detail page (no nested anchors — "Manage →" is a styled span). Presentational:
   the page derives every prop, this never fetches. */
export function EngagementCard({
  id,
  title,
  websiteUrl,
  businessName,
  statusKind,
  statusLabel,
  repo,
  open,
  done,
  badgeUrl,
  badgeInitials,
}: {
  id: string;
  title: string;
  websiteUrl?: string | null;
  businessName?: string | null;
  statusKind: EngagementStatusKind;
  statusLabel: string;
  repo?: string | null;
  open: number;
  done: number;
  badgeUrl?: string | null;
  badgeInitials: string;
}) {
  const total = open + done;
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <Link href={`/b/engagements/${id}`} className="eng-card">
      <EngagementLogo
        seed={id}
        websiteUrl={websiteUrl}
        businessName={businessName ?? title}
        initials={initialsFrom(businessName ?? title)}
        size={56}
        badgeUrl={badgeUrl}
        badgeInitials={badgeInitials}
      />

      <div className="eng-body">
        <div className="eng-name">{title}</div>
        <div className="eng-meta">
          <EngagementStatus kind={statusKind} label={statusLabel} />
          <span className="eng-dotsep" />
          <RepoChip repo={repo} />
        </div>
        <div className="eng-prog">
          <div className="eng-bar">
            <span style={{ width: `${pct}%` }} />
          </div>
          <span className="eng-prog-label">
            {done} of {total} done · {open} open
          </span>
        </div>
      </div>

      <div className="eng-aside">
        <span className="manage-btn">
          Manage
          <span className="mi">
            <ArrowRight size={14} strokeWidth={1.75} />
          </span>
        </span>
      </div>
    </Link>
  );
}
