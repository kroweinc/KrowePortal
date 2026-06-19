import type { ReactNode } from "react";

/** Card wrapper for a settings sub-section. Matches the visual language of the
    original /b/settings page (neutral border + white surface + soft shadow). */
export function SettingsSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
        {hint && <p className="text-xs text-neutral-500">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** Page heading shared by every settings sub-route. */
export function SettingsHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <header className="mb-1">
      <h1 className="text-lg font-semibold text-neutral-900">{title}</h1>
      <p className="text-sm text-neutral-500">{sub}</p>
    </header>
  );
}
