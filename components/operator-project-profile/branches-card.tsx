import { Icon } from "./icon";
import type { BranchGraph, BranchNode } from "@/lib/github/branches";

interface BranchesCardProps {
  graphPromise: Promise<BranchGraph | null>;
}

type Status = "main" | "diverged" | "feature" | "dev";

const STATUS_META: Record<
  Status,
  { label: string; color: string; soft: string }
> = {
  main: { label: "production", color: "var(--success)", soft: "var(--success-soft)" },
  diverged: { label: "diverged", color: "var(--warning)", soft: "var(--warning-soft)" },
  feature: { label: "feature", color: "var(--primary)", soft: "var(--primary-soft)" },
  dev: {
    label: "integration",
    color: "var(--muted-foreground)",
    soft: "var(--surface-subtle)",
  },
};

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diffMs = t - Date.now();
  const diffMin = Math.round(diffMs / 60_000);
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");
  const diffHr = Math.round(diffMin / 60);
  if (Math.abs(diffHr) < 24) return rtf.format(diffHr, "hour");
  const diffDay = Math.round(diffHr / 24);
  if (Math.abs(diffDay) < 30) return rtf.format(diffDay, "day");
  const diffMonth = Math.round(diffDay / 30);
  return rtf.format(diffMonth, "month");
}

function statusFor(node: BranchNode, isRoot: boolean): Status {
  if (isRoot) return "main";
  if (node.diverged) return "diverged";
  if (/^(dev|develop|develop[a-z]*|staging|integration)$/i.test(node.name)) return "dev";
  return "feature";
}

function BranchNodeRow({
  node,
  isRoot,
  hasParent,
}: {
  node: BranchNode;
  isRoot: boolean;
  hasParent: boolean;
}) {
  const status = statusFor(node, isRoot);
  const s = STATUS_META[status];
  const message = node.latestCommit?.message ?? "—";

  return (
    <div style={{ position: "relative" }}>
      {hasParent && <div className="tree-elbow" />}
      <div
        style={{
          padding: "10px 14px",
          borderRadius: "var(--radius-md)",
          border: "1px solid transparent",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3, flexWrap: "wrap" }}>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 13.5,
              fontWeight: 600,
              color: "var(--foreground)",
            }}
          >
            {node.name}
          </span>
          {node.tipSha ? (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11.5,
                color: "var(--muted-foreground)",
                background: "var(--surface-subtle)",
                border: "1px solid var(--border)",
                padding: "1px 7px",
                borderRadius: "var(--radius-sm)",
              }}
            >
              {node.tipSha}
            </span>
          ) : null}
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontFamily: "var(--font-sans)",
              fontSize: 10.5,
              fontWeight: 600,
              color: s.color,
              background: s.soft,
              padding: "2px 8px",
              borderRadius: "var(--radius-full)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            <span
              style={{
                width: 4,
                height: 4,
                borderRadius: "50%",
                background: s.color,
              }}
            />
            {s.label}
          </span>
        </div>
        <div
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 13.5,
            color: "var(--foreground)",
            lineHeight: 1.5,
          }}
        >
          {message}
        </div>
        {node.latestCommit?.date ? (
          <div
            style={{
              marginTop: 2,
              fontFamily: "var(--font-sans)",
              fontSize: 12,
              color: "var(--muted-foreground)",
            }}
          >
            {relTime(node.latestCommit.date)}
          </div>
        ) : null}
      </div>

      {node.children.length > 0 ? <BranchTree nodes={node.children} depth={1} /> : null}
    </div>
  );
}

function BranchTree({ nodes, depth }: { nodes: BranchNode[]; depth: number }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        paddingLeft: depth === 0 ? 0 : 28,
        position: "relative",
      }}
    >
      {depth > 0 && <div className="tree-rail" />}
      {nodes.map((n) => (
        <BranchNodeRow key={n.name} node={n} isRoot={false} hasParent={depth > 0} />
      ))}
    </div>
  );
}

export async function BranchesCard({ graphPromise }: BranchesCardProps) {
  const graph = await graphPromise;

  return (
    <div className="k-card k-card-pad">
      <div className="section-head">
        <div className="ember-wrap">
          <Icon name="branch" size={14} color="var(--primary)" />
        </div>
        <h2>Branches</h2>
        {graph ? (
          <span
            style={{
              marginLeft: "auto",
              fontFamily: "var(--font-sans)",
              fontSize: 12,
              color: "var(--muted-foreground)",
            }}
          >
            {graph.root.children.length + 1} active
          </span>
        ) : null}
      </div>

      {!graph || (graph.root.children.length === 0 && !graph.root.tipSha) ? (
        <p style={{ fontSize: 14, color: "var(--muted-foreground)" }}>
          We couldn&apos;t load branch information for this repo.
        </p>
      ) : graph.root.children.length === 0 ? (
        <>
          <BranchNodeRow node={graph.root} isRoot hasParent={false} />
          <p
            style={{
              marginTop: 10,
              fontSize: 13,
              color: "var(--muted-foreground)",
              fontStyle: "italic",
              fontFamily: "var(--font-serif)",
            }}
          >
            Just one branch — your builder hasn&apos;t opened any feature work yet.
          </p>
        </>
      ) : (
        <>
          <BranchNodeRow node={graph.root} isRoot hasParent={false} />
          {graph.truncated ? (
            <p
              style={{
                marginTop: 10,
                fontSize: 12,
                color: "var(--muted-foreground)",
              }}
            >
              + more branches not shown
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

export function BranchesCardSkeleton() {
  return (
    <div className="k-card k-card-pad">
      <div className="section-head">
        <div className="ember-wrap">
          <Icon name="branch" size={14} color="var(--primary)" />
        </div>
        <h2>Branches</h2>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              height: 56,
              background: "var(--surface-subtle)",
              borderRadius: "var(--radius-md)",
            }}
          />
        ))}
      </div>
    </div>
  );
}
