import type { NextConfig } from "next";
import path from "path";

const extraDevOrigins =
  process.env.NEXT_DEV_ALLOWED_ORIGINS?.split(/,\s*/)
    .map((s) => s.trim())
    .filter(Boolean) ?? [];

const assetPrefix = process.env.NEXT_PUBLIC_ASSET_PREFIX?.trim() || undefined;

const nextConfig: NextConfig = {
  assetPrefix,
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Dev-only: allow internal assets when the tab uses http://127.0.0.1, IPv6,
  // or your LAN IP (Network URL). Default allowlist only covers "localhost".
  allowedDevOrigins: ["127.0.0.1", "::1", ...extraDevOrigins],
  // When path-proxied behind krowehub.com, the portal serves its own chunks
  // from an absolute assetPrefix (its own origin), so those asset/font loads
  // are cross-origin to the page. Allow them so code-split chunks and next/font
  // files aren't blocked by CORS. Only active when an asset prefix is set.
  ...(assetPrefix
    ? {
        async headers() {
          return [
            {
              source: "/_next/:path*",
              headers: [
                { key: "Access-Control-Allow-Origin", value: "*" },
              ],
            },
          ];
        },
      }
    : {}),
};

export default nextConfig;
