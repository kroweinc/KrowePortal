import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Icon } from "./icon";

interface ReadmeCardProps {
  markdown: string;
  readmeUrl: string | null;
}

export function ReadmeCard({ markdown, readmeUrl }: ReadmeCardProps) {
  const trimmed = markdown.trim();

  return (
    <div className="k-card k-card-pad">
      <div className="section-head">
        <div className="ember-wrap">
          <Icon name="doc" size={14} color="var(--primary)" />
        </div>
        <h2>README</h2>
        {readmeUrl ? (
          <a
            href={readmeUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              marginLeft: "auto",
              fontFamily: "var(--font-sans)",
              fontSize: 13,
              fontWeight: 500,
              color: "var(--foreground)",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              borderBottom: "1px solid var(--border)",
              paddingBottom: 1,
            }}
          >
            View full README
            <Icon name="external" size={12} color="var(--muted-foreground)" />
          </a>
        ) : null}
      </div>

      {trimmed ? (
        <div
          className="md-content"
          style={{
            maxHeight: 420,
            overflowY: "auto",
            paddingRight: 8,
            WebkitMaskImage: "linear-gradient(to bottom, black 88%, transparent 100%)",
            maskImage: "linear-gradient(to bottom, black 88%, transparent 100%)",
          }}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{trimmed}</ReactMarkdown>
        </div>
      ) : (
        <p style={{ fontSize: 14, color: "var(--muted-foreground)" }}>
          No README on this repo yet.
        </p>
      )}
    </div>
  );
}
