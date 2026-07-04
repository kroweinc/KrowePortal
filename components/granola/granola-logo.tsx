import { assetUrl } from "@/lib/asset-url";

/** Official Granola app mark (black spiral on green, from granola.ai).
    Decorative — always rendered inside a labeled integration card.

    Plain <img> (not next/image): under the krowehub.com path proxy the
    optimizer endpoint `/_next/image` is served by the landing site and can't
    resolve the portal's source file, so the optimized logo 404s. `assetUrl`
    points the src straight at the portal origin instead. See lib/asset-url.ts
    and components/krowe-logo.tsx for the same pattern. */
export function GranolaLogo({ size = 52 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={assetUrl("/images/granola-logo.png")}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  );
}
