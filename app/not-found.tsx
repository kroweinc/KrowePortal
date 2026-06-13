import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-lg font-semibold text-neutral-900">Page not found</h1>
        <p className="mt-2 text-sm text-neutral-500">
          This page doesn&apos;t exist or may have moved.
        </p>
        <Link href="/" className="mt-4 inline-block text-sm text-neutral-700 underline">
          Go home
        </Link>
      </div>
    </main>
  );
}
