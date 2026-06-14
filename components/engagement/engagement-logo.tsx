import { BrandLogo } from "@/components/prd/brand-logo";
import "./engagement.css";

/* The square business "logo tile" shown on the left of every engagement card and
   in the Manage hero. Layers, bottom to top:
     1. a colored gradient tile with the business initials (the always-present
        fallback), tone picked deterministically per engagement so it's stable;
     2. <BrandLogo> resolving the real Brandfetch / favicon logo from the business
        website — when it loads, engagement.css hides the monogram and the logo
        fills the tile edge-to-edge; when it misses, BrandLogo's neutral fallback
        span is hidden so the gradient + initials show through.
   A small circular badge in the bottom-right corner carries the BUILDER's avatar
   (their photo, or initials). The badge is a sibling of the clipped tile so its
   white ring isn't cropped. */

const TONES = ["ink", "clay", "slate"] as const;
type Tone = (typeof TONES)[number];

/** Stable tone per engagement — the same seed always maps to the same color. */
function toneFor(seed: string): Tone {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return TONES[Math.abs(h) % TONES.length];
}

export function EngagementLogo({
  seed,
  websiteUrl,
  businessName,
  initials,
  size = 56,
  badgeUrl,
  badgeInitials,
}: {
  /** Stable color seed (use the engagement id). */
  seed: string;
  websiteUrl?: string | null;
  businessName?: string | null;
  /** Business initials shown on the gradient fallback tile. */
  initials: string;
  size?: number;
  /** Builder avatar image URL for the corner badge; initials shown when absent. */
  badgeUrl?: string | null;
  badgeInitials: string;
}) {
  const tone = toneFor(seed);
  return (
    <span className="eng-logo" style={{ width: size, height: size }}>
      <span className={`logo-tile logo-tile--${tone}`}>
        <span className="logo-tile-mono" style={{ fontSize: Math.round(size * 0.36) }}>
          {initials}
        </span>
        <BrandLogo
          domain={websiteUrl ?? undefined}
          name={businessName ?? undefined}
          size={size}
          fallback={initials}
          plain
        />
      </span>
      <span className="op-badge" title={badgeInitials}>
        {badgeUrl ? (
          // Plain <img>: signed Supabase Storage URL, no next/image remotePatterns needed.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={badgeUrl} alt="" />
        ) : (
          badgeInitials
        )}
      </span>
    </span>
  );
}
