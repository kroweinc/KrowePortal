import { ListChecks } from "lucide-react";
import { EngagementLogo } from "./engagement-logo";
import { EngagementStatus, type EngagementStatusKind } from "./engagement-status";
import { RepoChip } from "./repo-chip";
import { initialsFrom } from "./util";
import "./engagement.css";

/* The Manage view's hero band: the business logo tile (with the builder avatar
   badge), the engagement title + sub line, and a live stat row — connection
   status, task counts, and the GitHub repo — so the page opens with substance. */
export function DetailHero({
  id,
  title,
  sub,
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
  sub: string;
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
  return (
    <div className="detail-hero">
      <EngagementLogo
        seed={id}
        websiteUrl={websiteUrl}
        businessName={businessName ?? title}
        initials={initialsFrom(businessName ?? title)}
        size={64}
        badgeUrl={badgeUrl}
        badgeInitials={badgeInitials}
      />
      <div className="hero-body">
        <div className="hero-title">{title}</div>
        <div className="hero-sub">{sub}</div>
        <div className="hero-stats">
          <EngagementStatus kind={statusKind} label={statusLabel} />
          <span className="eng-dotsep" />
          <span className="eng-chip">
            <span className="ci">
              <ListChecks size={13} strokeWidth={1.75} />
            </span>
            {open} open · {done} done
          </span>
          <RepoChip repo={repo} />
        </div>
      </div>
    </div>
  );
}
