// Static "Go to" destinations for the ⌘K palette — client-side, never hit the
// DB, always available (even before the index loads or for a brand-new empty
// account). Shared by the search palette (components/global-search.tsx) and the
// agent hub's "Jump to" pills (components/agent/agent-console.tsx) so the two
// can't drift apart.

export interface NavCommand {
  id: string;
  title: string;
  href: string;
  keywords: string;
}

/**
 * Matches a builder's client page, whose id tells the palette which engagement
 * is in scope. Shared so the agent hub and the search omnibox can't disagree
 * about which client "here" means.
 */
export const ENGAGEMENT_PATH = /\/b\/engagements\/([0-9a-f-]{36})/i;

/**
 * Matches a builder's document/project page (`/b/projects/[id]/...`), whose id
 * is the PROJECT in view. Threaded into the agent turn so the document tools can
 * scope to that project — reaching docs (e.g. a draft PRD) under an orphan
 * project that no engagement links to. Shared so the omnibox and thread agree.
 */
export const PROJECT_PATH = /\/b\/projects\/([0-9a-f-]{36})/i;

/** The three document kinds a builder opens under a project. */
export type ViewedDocKind = "prd" | "quote" | "contract";
export interface ViewedDoc {
  kind: ViewedDocKind;
  id: string;
}

// A specific document page: `/b/projects/[id]/(prd|quotes|contract)/[docId]`.
// The `new` routes carry `/new` (not a UUID), so the id group excludes them.
const DOC_PATH = /\/b\/projects\/[0-9a-f-]{36}\/(prd|quotes|contract)\/([0-9a-f-]{36})/i;
// URL segment → canonical kind (the quotes route is plural; the kind is singular).
const DOC_SEGMENT_KIND: Record<string, ViewedDocKind> = {
  prd: "prd",
  quotes: "quote",
  contract: "contract",
};

/**
 * The specific document the builder is viewing, parsed from the pathname. Threaded
 * into the agent turn so that when the builder asks to change "the document"
 * without naming one, the agent assumes THIS document instead of asking which.
 * Null on the project overview and every non-document page.
 */
export function resolveViewedDoc(pathname: string | null | undefined): ViewedDoc | null {
  if (!pathname) return null;
  const m = pathname.match(DOC_PATH);
  if (!m) return null;
  const kind = DOC_SEGMENT_KIND[m[1].toLowerCase()];
  return kind ? { kind, id: m[2] } : null;
}

export const BUILDER_NAV: NavCommand[] = [
  { id: "nav-b-tasks", title: "Tasks", href: "/b", keywords: "tasks build board home" },
  { id: "nav-b-engagements", title: "Clients", href: "/b/engagements", keywords: "clients" },
  { id: "nav-b-projects", title: "Documents", href: "/b/projects", keywords: "documents projects prospects" },
  { id: "nav-b-new", title: "New document", href: "/b/projects/new", keywords: "new document project create" },
  { id: "nav-b-repo", title: "Repo", href: "/b/github", keywords: "repo github code repositories" },
  { id: "nav-b-profile", title: "Profile", href: "/b/profile", keywords: "profile resume portfolio" },
  { id: "nav-b-settings", title: "Settings", href: "/b/settings", keywords: "settings account display name email" },
  { id: "nav-b-settings-security", title: "Security", href: "/b/settings/security", keywords: "security password sign out sessions settings" },
  { id: "nav-b-settings-notifications", title: "Notifications", href: "/b/settings/notifications", keywords: "notifications email preferences settings" },
  { id: "nav-b-settings-quotes", title: "Quote Defaults", href: "/b/settings/quotes", keywords: "quote defaults pricing hourly rate payment terms settings" },
  { id: "nav-b-settings-github", title: "GitHub settings", href: "/b/settings/github", keywords: "github settings connect repo repositories" },
];

export const OPERATOR_NAV: NavCommand[] = [
  { id: "nav-o-tasks", title: "Tasks", href: "/o", keywords: "tasks home" },
  { id: "nav-o-engagement", title: "Builder", href: "/o/engagement", keywords: "builder profile contact documents" },
  { id: "nav-o-project", title: "Project", href: "/o/project", keywords: "project repo overview milestones" },
  { id: "nav-o-settings", title: "Settings", href: "/o/settings", keywords: "settings account display name email" },
  { id: "nav-o-settings-security", title: "Security", href: "/o/settings/security", keywords: "security password sign out sessions settings" },
  { id: "nav-o-settings-notifications", title: "Notifications", href: "/o/settings/notifications", keywords: "notifications email preferences settings" },
];

/**
 * The top-level destinations the agent hub demotes to pills — nav is no longer
 * the palette's lead action, so the settings sub-pages stay search-only.
 */
export const JUMP_TO_IDS = [
  "nav-b-tasks",
  "nav-b-engagements",
  "nav-b-projects",
  "nav-b-repo",
  "nav-b-profile",
] as const;

/**
 * The builder area's top-level sections, resolved from the current pathname. Lets
 * the agent surfaces (the toolbar omnibox and the hub) lean their suggestions,
 * placeholder, and capability order toward the page in view — and tell the agent
 * itself which page the builder is on. `general` is the neutral fallback
 * (profile, settings) where no section-specific lean applies.
 */
export type BuilderSection = "tasks" | "clients" | "documents" | "repo" | "agent" | "general";

/**
 * Classify a builder pathname into its section. Longest-prefix by construction;
 * the `/b` root — and its task-detail / staging pages — is the Tasks board, so it
 * is matched exactly rather than by prefix (a naive `startsWith("/b")` matches
 * everything). Mirrors the active-tab matching in components/sidebar.tsx.
 */
export function resolveBuilderSection(pathname: string | null | undefined): BuilderSection {
  if (!pathname) return "general";
  if (pathname === "/b" || pathname.startsWith("/b/tasks") || pathname.startsWith("/b/staging")) {
    return "tasks";
  }
  if (pathname.startsWith("/b/engagements")) return "clients";
  if (pathname.startsWith("/b/projects")) return "documents";
  if (pathname.startsWith("/b/github")) return "repo";
  if (pathname.startsWith("/b/agent")) return "agent";
  return "general";
}

/**
 * A human phrase naming the section, for the agent's page hint ("The builder is
 * viewing …"). Null where no lean helps — the neutral hub/agent surfaces and
 * settings/profile — so the turn stays unbiased there.
 */
export function sectionLabel(section: BuilderSection): string | null {
  switch (section) {
    case "tasks":
      return "the Tasks board";
    case "clients":
      return "a client's context page";
    case "documents":
      return "the Documents area";
    case "repo":
      return "the Repo page";
    default:
      return null;
  }
}
