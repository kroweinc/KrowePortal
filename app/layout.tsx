import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Toaster } from "sonner";
import { assetUrl } from "@/lib/asset-url";
import "./globals.css";

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
        alt: "Krowe — manage every operator-client in one workspace.",
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
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@300..700&family=Geist+Mono:wght@400..600&family=Instrument+Serif&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {children}
        {/* Sonner toast portal — without this, every toast.success/error across
            the app (save confirmations, AI errors, etc.) is a silent no-op. */}
        <Toaster richColors closeButton position="top-center" />
        <Analytics />
      </body>
    </html>
  );
}
