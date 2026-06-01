import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { getBriefs } from "@/lib/actions/briefs";
import { Ember } from "@/components/design-atoms";
import { Button } from "@/components/ui/button";
import { BriefStatusPill } from "@/components/brief/brief-status-pill";
import type { Brief } from "@/lib/types";

function formatCurrency(amount: number): string {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function BriefListPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "builder") redirect("/o");

  const briefs = await getBriefs();

  return (
    <main className="krowe-page">
      <div className="krowe-page-inner">
        <div className="krowe-page-head">
          <div>
            <h1 className="krowe-page-title">
              <Ember size={22} /> Briefs
            </h1>
            <div className="krowe-page-sub">
              <span>{briefs.length} brief{briefs.length !== 1 ? "s" : ""}</span>
              <span className="sep">·</span>
              <span style={{ fontStyle: "italic", textTransform: "none", letterSpacing: "normal" }}>
                Draft a quote, send it to the operator to accept.
              </span>
            </div>
          </div>
          <Link href="/b/brief/new">
            <Button>+ New brief</Button>
          </Link>
        </div>

        {briefs.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-2 mt-4">
            {briefs.map((b) => (
              <BriefRow key={b.id} brief={b} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-neutral-200 bg-white p-10 text-center mt-6">
      <p className="text-sm text-neutral-600 mb-1">No briefs yet.</p>
      <p className="text-xs text-neutral-400 mb-5">
        Draft a project brief from your engagement tasks. The operator can review and accept it before work begins.
      </p>
      <Link href="/b/brief/new">
        <Button>+ Draft your first brief</Button>
      </Link>
    </div>
  );
}

function BriefRow({ brief }: { brief: Brief }) {
  const total = brief.content.totals?.grand ?? 0;
  return (
    <Link
      href={`/b/brief/${brief.id}`}
      className="flex items-center justify-between gap-4 rounded-lg border border-neutral-200 bg-white px-4 py-3 hover:border-neutral-300 transition-colors"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-medium text-neutral-900 truncate">{brief.title}</span>
          <BriefStatusPill status={brief.status} />
        </div>
        <div className="text-xs text-neutral-500">
          Created {formatDate(brief.created_at)}
          {brief.sent_at && <> · Sent {formatDate(brief.sent_at)}</>}
          {brief.accepted_at && <> · Accepted {formatDate(brief.accepted_at)}</>}
          {brief.rejected_at && <> · Rejected {formatDate(brief.rejected_at)}</>}
        </div>
      </div>
      <div className="text-sm font-semibold text-neutral-900 shrink-0">{formatCurrency(total)}</div>
    </Link>
  );
}
