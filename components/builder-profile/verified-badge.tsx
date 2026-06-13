import { BadgeCheck } from "lucide-react";

export function VerifiedBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700"
      title="Verified — sourced from GitHub"
    >
      <BadgeCheck className="h-3 w-3" /> Verified
    </span>
  );
}
