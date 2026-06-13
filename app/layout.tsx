import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Krowe Portal",
  description: "Connecting operators and builders",
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
      </body>
    </html>
  );
}
