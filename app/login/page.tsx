import { Suspense } from "react";
import { LoginForm } from "./login-form";
import { PortalPreview, TrustLine, Wordmark } from "./portal-preview";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col-reverse md:flex-row-reverse">
      {/* Form panel */}
      <section
        className="flex flex-1 flex-col bg-[var(--background)] px-[clamp(1.5rem,5vw,3.25rem)] py-10 md:flex-[0_0_44%] md:border-l md:border-[var(--border)] md:py-[clamp(2.5rem,5vw,3.25rem)]"
        aria-label="Sign in"
      >
        <div className="hidden md:block">
          <Wordmark />
        </div>

        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-[340px]">
            <div className="mb-7 flex justify-center md:hidden">
              <Wordmark />
            </div>

            <Suspense>
              <LoginForm />
            </Suspense>
          </div>
        </div>

        <div className="hidden justify-center md:flex">
          <TrustLine />
        </div>
      </section>

      {/* Product-showcase panel — previews the portal you're signing into.
          Header + mockup are one vertically-centered group so the left panel's
          content lines up with the centered sign-in form on the right. */}
      <section
        className="krowe-sunrise relative hidden flex-1 flex-col justify-center overflow-hidden md:flex"
        aria-hidden
      >
        <div className="relative z-[2] pl-[clamp(2.5rem,4vw,3.25rem)] -translate-y-[clamp(1.25rem,3vh,2.5rem)]">
          <div className="max-w-[460px]">
            <h2
              className="text-[clamp(2rem,3.4vw,2.6rem)] leading-[1.1]"
              style={{ fontFamily: "var(--font-serif)", color: "var(--foreground)", letterSpacing: "-0.01em" }}
            >
              Every build, in one place.
            </h2>
            <p
              className="mt-3.5 max-w-[360px] text-[0.97rem] leading-relaxed"
              style={{ color: "var(--muted-foreground)", fontFamily: "var(--font-sans)" }}
            >
              Track tasks, review deliverables, and keep every engagement moving forward.
            </p>
          </div>

          {/* App window bleeds off the right edge for depth */}
          <div className="mt-[clamp(1.25rem,3vh,1.75rem)] -mr-[70px]">
            <PortalPreview />
          </div>
        </div>
      </section>
    </main>
  );
}
