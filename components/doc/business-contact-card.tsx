import { cn } from "@/lib/utils";
import { safeExternalHref } from "@/lib/project/business-context";

/* The prospect's business contact — name, email, the website / LinkedIn / live
   links, and freeform context. Lives on the project; every engagement, PRD,
   quote, and contract reads it live through their project_id link rather than
   copying it. Single source of truth: edit it on the project, it updates
   everywhere this renders.

   - variant="inline": bare block (project detail header, engagement rows).
   - variant="card":   bordered panel with a heading (doc "Prepared for" blocks,
                       the operator engagement tab).
   Returns null when there's nothing to show, so callers can render it
   unconditionally. */

// Fields are optional so every caller is assignable: a full Project, the
// joined engagement.project subset, and the operator BusinessContact all fit.
// The truthiness checks below treat undefined and null the same.
type BusinessContact = {
  prospect_name?: string | null;
  prospect_email?: string | null;
  website_url?: string | null;
  linkedin_url?: string | null;
  live_url?: string | null;
  context?: string | null;
};

interface BusinessContactCardProps {
  contact: BusinessContact | null | undefined;
  label?: string;
  variant?: "inline" | "card";
  className?: string;
}

export function BusinessContactCard({
  contact,
  label = "Business contact",
  variant = "inline",
  className,
}: BusinessContactCardProps) {
  if (!contact) return null;

  const { prospect_name, prospect_email, website_url, linkedin_url, live_url, context } = contact;
  const hasAny =
    prospect_name || prospect_email || website_url || linkedin_url || live_url || context;
  if (!hasAny) return null;

  const body = (
    <>
      {(prospect_name || prospect_email) && (
        <p className="text-sm text-neutral-500">
          {prospect_name}
          {prospect_name && prospect_email ? " · " : ""}
          {prospect_email}
        </p>
      )}
      {(linkedin_url || website_url || live_url) && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {live_url && (
            <a
              href={safeExternalHref(live_url)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-neutral-900 underline underline-offset-2 hover:text-neutral-600"
            >
              View live work ↗
            </a>
          )}
          {website_url && (
            <a
              href={safeExternalHref(website_url)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-neutral-600 hover:text-neutral-900 hover:underline"
            >
              Website ↗
            </a>
          )}
          {linkedin_url && (
            <a
              href={safeExternalHref(linkedin_url)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-neutral-600 hover:text-neutral-900 hover:underline"
            >
              LinkedIn ↗
            </a>
          )}
        </div>
      )}
      {context && <p className="mt-3 whitespace-pre-wrap text-sm text-neutral-600">{context}</p>}
    </>
  );

  if (variant === "card") {
    return (
      <section
        className={cn("rounded-lg border border-neutral-200 bg-white p-5 shadow-sm", className)}
      >
        <h2 className="mb-2 text-sm font-semibold text-neutral-900">{label}</h2>
        {body}
      </section>
    );
  }

  return <div className={className}>{body}</div>;
}
