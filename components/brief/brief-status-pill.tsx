import { Badge } from "@/components/ui/badge";
import type { BriefStatus } from "@/lib/types";

const LABELS: Record<BriefStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  signed: "Signed",
  accepted: "Accepted",
  rejected: "Rejected",
};

const VARIANTS: Record<BriefStatus, "secondary" | "sent" | "approved" | "blocked"> = {
  draft: "secondary",
  sent: "sent",
  signed: "approved",
  accepted: "approved",
  rejected: "blocked",
};

export function BriefStatusPill({ status }: { status: BriefStatus }) {
  return <Badge variant={VARIANTS[status]}>{LABELS[status]}</Badge>;
}
