import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Toaster } from "sonner";
import { assetUrl } from "@/lib/asset-url";
import "./globals.css";

// Self-hosted via next/font — fonts are built into our own bundle, so there's no
// render-blocking request to fonts.googleapis.com + fonts.gstatic.com on first
// paint, no extra DNS/TLS round-trips, and no flash of unstyled text. The CSS
// variables below feed the --font-sans/-serif/-mono tokens in globals.css.
const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-instrument-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Krowe",
    template: "Krowe | %s",
  },
  description: "Connecting operators and builders",
  // Link-preview (Open Graph / Twitter) art. Same proxy caveat as icons below:
  // the og:image must be an absolute URL on the portal's own origin, or the
  // krowehub.com path proxy resolves it against the landing site and 404s.
  // assetUrl() pins it to the portal origin. Image lives in public/ at the
  // standard 1200x630.
  openGraph: {
    title: "Krowe",
    description:
      "Manage every operator-client in one workspace: delivery, comments, and ongoing conversation co-located with the work.",
    images: [
      {
        url: assetUrl("/opengraph-image.png"),
        width: 1200,
        height: 630,
        alt: "Krowe",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Krowe",
    description:
      "Manage every operator-client in one workspace: delivery, comments, and ongoing conversation co-located with the work.",
    images: [assetUrl("/twitter-image.png")],
  },
  // Icons live in public/ (not the app/ file convention) and are referenced
  // with absolute, asset-prefixed URLs. Under the krowehub.com path proxy, a
  // root-relative `/favicon.ico` resolves against the landing-site origin and
  // serves the wrong icon; assetUrl() pins these to the portal's own origin.
  // See lib/asset-url.ts and the logo fix in 91b3c25.
  icons: {
    icon: [
      { url: assetUrl("/favicon.ico"), sizes: "256x256", type: "image/x-icon" },
      { url: assetUrl("/icon.png"), sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: assetUrl("/apple-icon.png"), sizes: "180x180", type: "image/png" },
    ],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable}`}
    >
      <body>
        {children}
        {/* Sonner toast portal — without this, every toast.success/error across
            the app (save confirmations, AI errors, etc.) is a silent no-op. */}
        <Toaster richColors closeButton position="top-center" />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
