import { Sparkles, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { ProjectProfile } from "@/lib/actions/generate-project-profile";
import { FeaturesList } from "./features-list";

interface AiOverviewCardProps {
  profilePromise: Promise<ProjectProfile | null>;
}

const STATE_LABELS: Record<string, string> = {
  early: "Early stage",
  active: "Actively developed",
  mature: "Mature",
  dormant: "Dormant",
};

const STATE_VARIANTS: Record<string, BadgeProps["variant"]> = {
  early: "sent",
  active: "done",
  mature: "secondary",
  dormant: "blocked",
};

export async function AiOverviewCard({ profilePromise }: AiOverviewCardProps) {
  const profile = await profilePromise;

  if (!profile) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-neutral-400" aria-hidden />
            Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              Couldn&apos;t generate an AI summary right now. The factual sections below still
              reflect the live repo.
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const stateLabel = STATE_LABELS[profile.currentState] ?? profile.currentState;
  const stateVariant = STATE_VARIANTS[profile.currentState] ?? "secondary";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-neutral-400" aria-hidden />
            Overview
          </CardTitle>
          <Badge variant={stateVariant} title={profile.stateRationale}>
            {stateLabel}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-neutral-700 leading-relaxed">{profile.summary}</p>

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
            Who it&apos;s for
          </p>
          <p className="mt-1 text-neutral-700 leading-relaxed">{profile.audience}</p>
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
            Features
          </p>
          <FeaturesList features={profile.features} />
        </div>

        <p className="text-xs text-neutral-400 italic">
          {profile.stateRationale}
        </p>
      </CardContent>
    </Card>
  );
}

export function AiOverviewSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-neutral-400 animate-pulse" aria-hidden />
          Overview
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="h-4 w-full animate-pulse rounded bg-neutral-100" />
        <div className="h-4 w-11/12 animate-pulse rounded bg-neutral-100" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-neutral-100" />
        <div className="pt-2 space-y-2">
          <div className="h-3 w-24 animate-pulse rounded bg-neutral-100" />
          <div className="h-4 w-4/5 animate-pulse rounded bg-neutral-100" />
        </div>
      </CardContent>
    </Card>
  );
}
