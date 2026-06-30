"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaced in server/client logs; the digest correlates to the server trace.
    console.error("[app/error]", error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-lg font-semibold text-neutral-900">Something went wrong</h1>
        <p className="mt-2 text-sm text-neutral-500">
          An unexpected error occurred. You can try again, or head back home.
        </p>
        <div className="mt-5 flex items-center justify-center gap-3">
          <Button onClick={reset}>Try again</Button>
          <Link href="/" className="text-sm text-neutral-700 underline">
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}
