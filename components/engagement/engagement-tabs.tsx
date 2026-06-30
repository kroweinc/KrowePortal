"use client";

import { useState, type ReactNode } from "react";
import { Info, Library } from "lucide-react";
import "./engagement.css";

/* Top-level tabs for the client (engagement) detail view. The tab bar sits on
   the same row as the "Clients" back link (passed in as `backlink`); the hero
   renders below it, then the active panel. "Info" holds the business info,
   documents, settings, repo, and danger zone; "Context" holds the
   client-context library. Both panels stay mounted (toggled with `hidden`) so
   the ContextPanel keeps its loaded items and in-flight state across switches.
   Content is server-rendered upstream and passed in as props. */
export function EngagementTabs({
  backlink,
  hero,
  info,
  context,
}: {
  backlink: ReactNode;
  hero: ReactNode;
  info: ReactNode;
  context: ReactNode;
}) {
  const [tab, setTab] = useState<"info" | "context">("info");

  return (
    <>
      <div className="eng-topbar">
        {backlink}
        <div className="eng-tabbar" role="tablist" aria-label="Client view">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "info"}
            className={"eng-tab" + (tab === "info" ? " is-active" : "")}
            onClick={() => setTab("info")}
          >
            <Info size={15} strokeWidth={1.75} /> Info
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "context"}
            className={"eng-tab" + (tab === "context" ? " is-active" : "")}
            onClick={() => setTab("context")}
          >
            <Library size={15} strokeWidth={1.75} /> Context
          </button>
        </div>
      </div>

      {hero}

      <div role="tabpanel" aria-label="Info" hidden={tab !== "info"}>
        {info}
      </div>
      <div role="tabpanel" aria-label="Context" hidden={tab !== "context"}>
        {context}
      </div>
    </>
  );
}
