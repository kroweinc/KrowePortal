import { ScrollText, ShieldCheck } from "lucide-react";
import type { EngagementAgreement } from "@/lib/types";

function warrantyState(signedAt: string | null, days: number): { label: string; tone: string } {
  if (!signedAt) return { label: `${days}-day window starts at launch`, tone: "text-neutral-500" };
  const end = new Date(signedAt).getTime() + days * 86_400_000;
  const remaining = Math.ceil((end - Date.now()) / 86_400_000);
  if (remaining > 0) return { label: `${remaining} day${remaining === 1 ? "" : "s"} left`, tone: "text-emerald-700" };
  return { label: "Expired", tone: "text-neutral-400" };
}

export function OperatingAgreementCard({
  agreement,
  signedAt,
}: {
  agreement: EngagementAgreement | null;
  signedAt: string | null;
}) {
  const warrantyDays = agreement?.warranty_days ?? 30;
  const w = warrantyState(signedAt, warrantyDays);
  const decisionRights = agreement?.decision_rights ?? [];
  const channels = agreement?.comm_channels ?? [];

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <ScrollText className="h-4 w-4 text-neutral-500" />
        <h2 className="text-sm font-semibold text-neutral-900">How we work together</h2>
      </div>

      <div className="mb-4 flex items-center gap-2 rounded-md bg-neutral-50 px-3 py-2">
        <ShieldCheck className="h-4 w-4 text-neutral-500" />
        <span className="text-sm text-neutral-700">
          Warranty: {warrantyDays}-day bug-fix window
        </span>
        <span className={`ml-auto text-xs font-medium ${w.tone}`}>{w.label}</span>
      </div>

      {decisionRights.length > 0 && (
        <div className="mb-4">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">Decision rights</div>
          <table className="w-full text-xs">
            <thead className="text-neutral-400">
              <tr>
                <th className="py-1 text-left font-medium">Decision</th>
                <th className="py-1 text-left font-medium">Signs</th>
                <th className="py-1 text-left font-medium">Reviews</th>
                <th className="py-1 text-left font-medium">Informed</th>
              </tr>
            </thead>
            <tbody>
              {decisionRights.map((d, i) => (
                <tr key={i} className="border-t border-neutral-100 text-neutral-700">
                  <td className="py-1.5 pr-2">{d.decision}</td>
                  <td className="py-1.5 pr-2">{d.signer}</td>
                  <td className="py-1.5 pr-2">{d.reviewer}</td>
                  <td className="py-1.5">{d.informed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(agreement?.review_cadence || agreement?.meeting_schedule) && (
        <div className="mb-3 space-y-1 text-sm text-neutral-700">
          {agreement?.meeting_schedule && (
            <div><span className="text-neutral-400">Meetings:</span> {agreement.meeting_schedule}</div>
          )}
          {agreement?.review_cadence && (
            <div><span className="text-neutral-400">Reviews:</span> {agreement.review_cadence}</div>
          )}
        </div>
      )}

      {channels.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">Channels</div>
          <ul className="space-y-1 text-sm text-neutral-700">
            {channels.map((c, i) => (
              <li key={i}>
                <span className="font-medium">{c.channel}</span>
                {c.purpose && <span className="text-neutral-500"> — {c.purpose}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {decisionRights.length === 0 && channels.length === 0 && !agreement?.review_cadence && (
        <p className="text-xs text-neutral-400">Your builder hasn&apos;t set the operating agreement yet.</p>
      )}
    </div>
  );
}
