import type { ReactNode } from "react";

/** Card wrapper for a settings sub-section. Uses the krowe-set-* design
    ported from the Settings.html design file (claude.ai/design). */
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
    <section className="krowe-set-card">
      <div className="krowe-set-card-head">
        <h2 className="krowe-set-card-title">{title}</h2>
        {hint && <p className="krowe-set-card-hint">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** Page heading shared by every settings sub-route. */
export function SettingsHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <header className="krowe-set-head">
      <h1 className="krowe-set-title">{title}</h1>
      <p className="krowe-set-desc">{sub}</p>
    </header>
  );
}
