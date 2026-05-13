import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
            Krowe Portal
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Sign in with your email — we&apos;ll send a magic link.
          </p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
