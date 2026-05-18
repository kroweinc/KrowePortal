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
      <body>
        <RoleProvider initialRole={profile?.role ?? null}>
          {children}
          <Toaster richColors position="top-center" />
        </RoleProvider>
      </body>
    </html>
  );
}
