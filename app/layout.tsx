import type { Metadata } from "next";
import "./globals.css";
import { getCurrentProfile } from "@/lib/auth";
import { RoleProvider } from "@/lib/role-context";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "Krowe Portal",
  description: "Connecting operators and builders",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();
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
        <RoleProvider initialRole={profile?.role ?? null}>
          {children}
          <Toaster richColors position="top-center" />
        </RoleProvider>
      </body>
    </html>
  );
}
