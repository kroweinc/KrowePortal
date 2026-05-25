import { Suspense } from "react";
import { Code2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RepoContext } from "@/lib/github/types";
import type { ProjectProfile } from "@/lib/actions/generate-project-profile";
import { ServicesList, ServicesSkeleton } from "./services-list";

interface LanguagesBarProps {
  context: RepoContext;
  profilePromise: Promise<ProjectProfile | null>;
}

const COLORS = [
  "bg-sky-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-rose-500",
];

export function LanguagesBar({ context, profilePromise }: LanguagesBarProps) {
  const { languages } = context;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Code2 className="h-4 w-4 text-neutral-400" aria-hidden />
          Tech stack
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
            Languages
          </p>
          {languages.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-400">No language data available.</p>
          ) : (
            <>
              <div className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-neutral-100">
                {languages.map((lang, i) => (
                  <div
                    key={lang.name}
                    className={COLORS[i % COLORS.length]}
                    style={{ width: `${lang.pct}%` }}
                    title={`${lang.name} ${lang.pct}%`}
                  />
                ))}
              </div>
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                {languages.map((lang, i) => (
                  <li key={lang.name} className="flex items-center gap-1.5 text-sm">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${COLORS[i % COLORS.length]}`}
                      aria-hidden
                    />
                    <span className="text-neutral-700">{lang.name}</span>
                    <span className="text-neutral-400">{lang.pct}%</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
            Services
          </p>
          <div className="mt-2">
            <Suspense fallback={<ServicesSkeleton />}>
              <ServicesList profilePromise={profilePromise} />
            </Suspense>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
