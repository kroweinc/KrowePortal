import {
  Boxes,
  Cloud,
  CodeXml,
  Database,
  Eye,
  GitBranch,
  GitFork,
  History,
  RefreshCw,
  Star,
  Tag,
  User,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ArchLayer } from "@/lib/operator-project/derive-arch-layers";
import type { RepoContext } from "@/lib/github/types";
import type { RepoSocialStats } from "@/lib/github/repo-insights";
import { SectionHead } from "./section-head";
import { LanguagePie } from "./language-pie";
import { languageColor, techColor } from "./colors";

export type ToolkitStats = {
  commits2w: number;
  branches: number;
  contributors: number;
  /** Last commit timestamp; drives the "· ago / synced" pill. */
  lastCommitIso: string | null;
  social: RepoSocialStats;
};

/** Compact age — "2h", "3d", "5w". Null when we have no timestamp. */
function shortAge(iso: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const mins = Math.max(0, Math.floor((Date.now() - t) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

function Stat({
  icon: Icon,
  value,
  label,
}: {
  icon: LucideIcon;
  value: string | number | null;
  label: string;
}) {
  return (
    <div className="krowe-repo-card krowe-repo-stat">
      <Icon size={13} strokeWidth={2} aria-hidden />
      <span className="krowe-repo-stat-pair">
        {/* An unavailable stat reads as an em dash rather than a misleading 0. */}
        <span className="krowe-repo-stat-value">{value ?? "—"}</span>
        <span className="krowe-repo-stat-label">{label}</span>
      </span>
    </div>
  );
}

const LAYER_ICON: Record<ArchLayer["icon"], LucideIcon> = {
  code: CodeXml,
  cloud: Cloud,
  db: Database,
  branch: GitBranch,
};

function LayerCard({ layer }: { layer: ArchLayer }) {
  const Icon = LAYER_ICON[layer.icon];
  return (
    <div className="krowe-repo-card krowe-repo-layer">
      <div className="krowe-repo-layer-head">
        <span>{layer.role}</span>
        <Icon size={13} strokeWidth={2} aria-hidden />
      </div>
      <div className="krowe-repo-layer-chips">
        {layer.items.map((item) => (
          <span
            key={item}
            className="krowe-repo-tech"
            style={{ "--tech": techColor(item) } as React.CSSProperties}
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

interface ToolkitSectionProps {
  stats: ToolkitStats;
  layers: ArchLayer[];
  languages: RepoContext["languages"];
}

export function ToolkitSection({ stats, layers, languages }: ToolkitSectionProps) {
  const { social } = stats;
  // GitHub rounds to whole percent, so trailing languages can land on 0 — they
  // draw no slice, so listing them in the legend is just noise.
  const shown = languages.filter((l) => l.pct > 0);

  return (
    <div className="krowe-repo-section">
      <SectionHead icon={Boxes} title="Toolkit" />

      <div className="krowe-repo-toolkit">
        {/* Two columns, filled down-then-across to match the design. */}
        <div className="krowe-repo-stats">
          <Stat icon={History} value={stats.commits2w} label="commits / 2w" />
          <Stat icon={GitFork} value={social.forks} label="forks" />
          <Stat icon={GitBranch} value={stats.branches} label="branches" />
          <Stat icon={Star} value={social.stars} label="stars" />
          <Stat icon={RefreshCw} value={shortAge(stats.lastCommitIso)} label="ago / synced" />
          <Stat icon={Eye} value={social.watchers} label="viewing" />
          <Stat icon={User} value={stats.contributors} label="contributors" />
          <Stat icon={Tag} value={social.releases} label="releases" />
        </div>

        {layers.length > 0 && (
          <div className="krowe-repo-layers">
            {layers.map((layer) => (
              <LayerCard key={layer.role} layer={layer} />
            ))}
          </div>
        )}

        {shown.length > 0 && (
          <div className="krowe-repo-card krowe-repo-langs">
            <LanguagePie languages={shown} />
            <ul className="krowe-repo-legend">
              {shown.map((lang) => (
                <li key={lang.name}>
                  <span
                    className="dot"
                    style={{ background: languageColor(lang.name) }}
                    aria-hidden
                  />
                  {lang.name} {lang.pct}%
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export function ToolkitSectionSkeleton() {
  return (
    <div className="krowe-repo-section">
      <SectionHead icon={Boxes} title="Toolkit" />
      <div className="krowe-repo-toolkit">
        <div className="krowe-repo-stats">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="krowe-skel" style={{ width: 150, height: 40 }} />
          ))}
        </div>
        <div className="krowe-repo-layers">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="krowe-skel" style={{ width: 124, height: 122 }} />
          ))}
        </div>
        {/* Without this the pie card pops in on hydration and shifts the row. */}
        <div className="krowe-skel" style={{ flex: "1 1 280px", minWidth: 240, height: 144 }} />
      </div>
    </div>
  );
}
