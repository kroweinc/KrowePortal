import Link from "next/link";
import { Icon } from "./icon";

interface ProjectHeaderProps {
  title: string;
  org: string | null;
  repoName: string | null;
  tagline: string | null;
  branch: string;
  repoUrl: string | null;
  builderName: string | null;
  startedAt: string;
  /** When set, renders a Settings button linking to repo/GitHub settings. */
  settingsHref?: string;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function ProjectHeader({
  title,
  org,
  repoName,
  tagline,
  branch,
  repoUrl,
  builderName,
  startedAt,
  settingsHref,
}: ProjectHeaderProps) {
  const fallbackTagline = builderName
    ? `Built by ${builderName} · started ${formatDate(startedAt)}`
    : `Started ${formatDate(startedAt)}`;

  return (
    <header
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 32,
        marginBottom: 8,
        flexWrap: "wrap",
      }}
    >
      <div style={{ minWidth: 0, flex: "1 1 auto" }}>
        {/* Breadcrumb */}
        {org && repoName ? (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontFamily: "var(--font-sans)",
              fontSize: 13.5,
              color: "var(--muted-foreground)",
              marginBottom: 10,
            }}
          >
            <Icon name="github" size={15} />
            <span>{org}</span>
            <span style={{ color: "var(--border)" }}>/</span>
            {repoUrl ? (
              <a
                href={repoUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  color: "var(--foreground)",
                  textDecoration: "none",
                  fontWeight: 500,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {repoName}
                <Icon name="external" size={12} color="var(--muted-foreground)" />
              </a>
            ) : (
              <span style={{ color: "var(--foreground)", fontWeight: 500 }}>{repoName}</span>
            )}
          </div>
        ) : (
          <p
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: 11,
              fontWeight: 600,
              color: "var(--muted-foreground)",
              textTransform: "uppercase",
              letterSpacing: "0.14em",
              marginBottom: 10,
            }}
          >
            Project
          </p>
        )}

        {/* Editorial title */}
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-serif)",
            fontSize: 64,
            lineHeight: 1.02,
            letterSpacing: "-0.02em",
            fontWeight: 400,
            color: "var(--foreground)",
          }}
        >
          {title}
        </h1>

        {/* Tagline */}
        <p
          style={{
            margin: "10px 0 18px",
            fontFamily: "var(--font-sans)",
            fontSize: 16.5,
            color: "var(--muted-foreground)",
            maxWidth: 640,
          }}
        >
          {tagline ?? fallbackTagline}
        </p>

        {/* Branch chip */}
        {repoName ? (
          <span className="pill">
            <Icon name="branch" size={13} color="var(--muted-foreground)" />
            <span style={{ color: "var(--muted-foreground)", fontWeight: 400 }}>branch</span>
            <span
              style={{
                color: "var(--foreground)",
                fontFamily: "var(--font-mono)",
                fontSize: 12.5,
                fontWeight: 500,
              }}
            >
              {branch}
            </span>
          </span>
        ) : null}
      </div>

      {/* Action buttons */}
      {repoUrl ? (
        <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
          <a
            href={repoUrl}
            target="_blank"
            rel="noreferrer"
            className="k-btn"
          >
            <Icon name="github" size={14} />
            View on GitHub
            <Icon name="external" size={12} color="var(--muted-foreground)" />
          </a>
          {settingsHref ? (
            <Link href={settingsHref} className="k-btn">
              <Icon name="settings" size={14} />
              Settings
            </Link>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
