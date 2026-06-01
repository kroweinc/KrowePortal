import Link from "next/link";
import { Icon } from "./icon";
import { EmberGlyph } from "./ember-glyph";

export function NoProjectYet() {
  return (
    <div className="k-card k-card-pad">
      <div className="section-head">
        <div className="ember-wrap">
          <EmberGlyph size={12} />
        </div>
        <h2>No project yet</h2>
      </div>
      <p
        style={{
          margin: "0 0 12px",
          fontSize: 14.5,
          lineHeight: 1.6,
          color: "var(--foreground)",
        }}
      >
        You don&apos;t have a project set up yet. Once you&apos;re paired with a builder, your
        project will show up here.
      </p>
      <Link href="/o" className="dashed-link" style={{ fontSize: 13.5, fontWeight: 500 }}>
        Back to your tasks →
      </Link>
    </div>
  );
}

export function CodeNotConnectedYet() {
  return (
    <div className="k-card k-card-pad">
      <div className="section-head">
        <div className="ember-wrap">
          <Icon name="code" size={14} color="var(--primary)" />
        </div>
        <h2>Project details aren&apos;t ready yet</h2>
      </div>
      <p
        style={{
          margin: "0 0 8px",
          fontSize: 14.5,
          lineHeight: 1.6,
          color: "var(--foreground)",
        }}
      >
        Your builder hasn&apos;t connected this project&apos;s code yet, so there&apos;s no
        overview to show.
      </p>
      <p style={{ margin: 0, fontSize: 13.5, color: "var(--muted-foreground)" }}>
        You&apos;ll still see tasks on the Tasks tab — the full project summary will fill in
        once that&apos;s set up.
      </p>
    </div>
  );
}
