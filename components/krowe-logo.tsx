import { cn } from "@/lib/utils";
import { assetUrl } from "@/lib/asset-url";

/** Intrinsic pixel size of `public/images/KroweLogo.png`. */
const LOGO_WIDTH = 526;
const LOGO_HEIGHT = 191;

export type KroweLogoProps = {
  className?: string;
  priority?: boolean;
};

/**
 * Krowe wordmark.
 *
 * Plain <img> (not next/image): under the krowehub.com path proxy the optimizer
 * endpoint `/_next/image` is served by the landing site and can't resolve the
 * portal's source file, so the optimized logo 404s. `assetUrl` points the src
 * straight at the portal origin instead. See lib/asset-url.ts.
 *
 * Height is set in CSS (`h-[26px]`, overridable via `className`); `width: auto`
 * in `style` lets the width follow the aspect ratio. The intrinsic
 * `width`/`height` attributes reserve space to avoid layout shift. Do NOT also
 * set `height: auto` — inline style beats the height class and the logo balloons
 * to its intrinsic 526×191.
 */
export function KroweLogo({ className, priority }: KroweLogoProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={assetUrl("/images/KroweLogo.png")}
      alt="Krowe"
      width={LOGO_WIDTH}
      height={LOGO_HEIGHT}
      loading={priority ? "eager" : undefined}
      fetchPriority={priority ? "high" : undefined}
      className={cn("h-[26px] w-auto max-w-none object-contain", className)}
      style={{ width: "auto" }}
    />
  );
}
