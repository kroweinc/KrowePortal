import { Cloud } from "lucide-react";
import type { ProjectProfile } from "@/lib/actions/generate-project-profile";

interface ServicesListProps {
  profilePromise: Promise<ProjectProfile | null>;
}

export async function ServicesList({ profilePromise }: ServicesListProps) {
  const profile = await profilePromise;
  const services = profile?.services ?? [];

  if (services.length === 0) {
    return (
      <p className="text-xs text-neutral-400">
        No external services detected.
      </p>
    );
  }

  return (
    <ul className="flex flex-wrap gap-2">
      {services.map((s) => (
        <li
          key={s.name}
          className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-xs"
          title={s.purpose}
        >
          <Cloud className="h-3 w-3 text-neutral-400" aria-hidden />
          <span className="font-medium text-neutral-800">{s.name}</span>
          <span className="text-neutral-400">·</span>
          <span className="text-neutral-500">{s.purpose}</span>
        </li>
      ))}
    </ul>
  );
}

export function ServicesSkeleton() {
  return (
    <div className="flex flex-wrap gap-2">
      <div className="h-6 w-28 animate-pulse rounded-md bg-neutral-100" />
      <div className="h-6 w-36 animate-pulse rounded-md bg-neutral-100" />
      <div className="h-6 w-24 animate-pulse rounded-md bg-neutral-100" />
    </div>
  );
}
