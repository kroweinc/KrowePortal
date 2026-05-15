import type { NextConfig } from "next";
import path from "path";

const extraDevOrigins =
  process.env.NEXT_DEV_ALLOWED_ORIGINS?.split(/,\s*/)
    .map((s) => s.trim())
    .filter(Boolean) ?? [];

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Dev-only: allow internal assets when the tab uses http://127.0.0.1, IPv6,
  // or your LAN IP (Network URL). Default allowlist only covers "localhost".
  allowedDevOrigins: ["127.0.0.1", "::1", ...extraDevOrigins],
};

export default nextConfig;
