"use client";

import { useState } from "react";
import { Icon } from "./icon";

interface StructureCardProps {
  entries: string[];
}

export function StructureCard({ entries }: StructureCardProps) {
  const [active, setActive] = useState<string | null>(null);

  if (entries.length === 0) {
    return (
      <div className="k-card k-card-pad">
        <div className="section-head">
          <div className="ember-wrap">
            <Icon name="tree" size={14} color="var(--primary)" />
          </div>
          <h2>Project structure</h2>
        </div>
        <p style={{ fontSize: 14, color: "var(--muted-foreground)" }}>
          No top-level files to show.
        </p>
      </div>
    );
  }

  const mid = Math.ceil(entries.length / 2);
  const cols = [entries.slice(0, mid), entries.slice(mid)];

  return (
    <div className="k-card k-card-pad">
      <div className="section-head">
        <div className="ember-wrap">
          <Icon name="tree" size={14} color="var(--primary)" />
        </div>
        <h2>Project structure</h2>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: "var(--font-sans)",
            fontSize: 12,
            color: "var(--muted-foreground)",
          }}
        >
          {entries.length} entries · root
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {cols.map((col, ci) => (
          <div key={ci} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {col.map((f) => {
              const isDir = f.endsWith("/");
              const isFlag = f.startsWith("--");
              const isActive = active === f;
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setActive(f)}
                  className={`file-row ${isActive ? "active" : ""}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "7px 10px",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                    width: "100%",
                  }}
                >
                  <Icon
                    name={isFlag ? "file" : isDir ? "folder" : "doc"}
                    size={15}
                    color={
                      isDir
                        ? "var(--primary)"
                        : "var(--muted-foreground)"
                    }
                  />
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 13,
                      color: "var(--foreground)",
                      fontWeight: isActive ? 600 : 400,
                    }}
                  >
                    {f}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
