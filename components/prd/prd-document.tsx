/* Polished editorial read-only renderer for a PRD — the exact document the
   recipient receives. Used by the in-builder Preview and the public client
   page so they look identical. Ported from the Claude Design prototype's
   PrdDoc, with the legacy-field fallbacks from the old PrdView merged in so
   older PRDs don't lose sections. */

import type { ReactNode } from "react";
import type { PrdContent, PrdPriority, PrdStackItem } from "@/lib/types";
import "./prd-document.css";

const PRIORITY_LABEL: Record<PrdPriority, string> = { must: "Must", should: "Should", could: "Could" };

type StackLayer = NonNullable<PrdStackItem["layer"]>;
const STACK_ORDER: StackLayer[] = ["frontend", "backend", "database", "email", "hosting", "other"];
const STACK_LABEL: Record<StackLayer, string> = {
  frontend: "Frontend",
  backend: "Backend",
  database: "Database",
  email: "Email",
  hosting: "Hosting",
  other: "Other",
};

function DocSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="doc-section">
      <h3 className="doc-section__title">{title}</h3>
      {children}
    </section>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="doc-bullets">
      {items.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ul>
  );
}

function DocCost({ value, estimated }: { value?: string | null; estimated?: boolean }) {
  if (!value) return null;
  return (
    <span className="doc-cost">
      {value}
      {estimated && <span className="doc-cost__est"> (est.)</span>}
    </span>
  );
}

function DocEstimate() {
  return <p className="doc-estimate">Some monthly costs are estimates — confirm with each vendor before relying on them.</p>;
}

export function PrdDocument({ content: c }: { content: PrdContent }) {
  const integrationsEst = (c.integrations ?? []).some((i) => i.estimated);
  const stackEst = (c.techStack ?? []).some((i) => i.estimated);
  const stackHasLayers = (c.techStack ?? []).some((i) => i.layer);
  const stackGroups = STACK_ORDER.map((layer) => ({
    layer,
    items: (c.techStack ?? []).filter((i) => (i.layer ?? "other") === layer),
  })).filter((g) => g.items.length > 0);
  const cd = c.constraintsDetail ?? {};
  const hasCd = !!(cd.deadline || cd.budget || cd.branding || cd.security);
  const constraintsList = c.constraints ?? [];
  const users = c.users ?? [];
  const scopeLater = c.scopeLater ?? [];
  const nonGoals = c.nonGoals ?? [];
  const milestoneList = c.milestoneList ?? [];

  return (
    <div className="doc-body">
      {c.overview && (
        <DocSection title="Overview">
          <p className="doc-prose">{c.overview}</p>
        </DocSection>
      )}
      {(c.goals ?? []).length > 0 && (
        <DocSection title="Goals">
          <Bullets items={c.goals!} />
        </DocSection>
      )}
      {(c.successMetrics ?? []).length > 0 && (
        <DocSection title="Success Metrics">
          <Bullets items={c.successMetrics!} />
        </DocSection>
      )}

      {users.length > 0 && (
        <DocSection title="Who It's For">
          <ul className="doc-objlist">
            {users.map((u, i) => (
              <li key={i}>
                <div className="doc-obj__head">
                  <span className="doc-obj__name">{u.role}</span>
                  {u.authLevel && <span className="doc-chip">{u.authLevel}</span>}
                </div>
                {u.description && <p className="doc-obj__desc">{u.description}</p>}
                {(u.permissions ?? []).length > 0 && (
                  <ul className="doc-subbullets">
                    {u.permissions!.map((p, j) => (
                      <li key={j}>{p}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </DocSection>
      )}

      {users.length === 0 && c.targetUsers && (
        <DocSection title="Target Users">
          <p className="doc-prose">{c.targetUsers}</p>
        </DocSection>
      )}

      {(c.coreUserFlow ?? []).length > 0 && (
        <DocSection title="Core User Flow">
          <ol className="doc-ordered">
            {c.coreUserFlow!.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </DocSection>
      )}

      {(c.features ?? []).length > 0 && (
        <DocSection title="Features">
          <ul className="doc-objlist">
            {c.features!.map((f, i) => (
              <li key={i}>
                <div className="doc-obj__head">
                  <span className="doc-obj__name">{f.title}</span>
                  {f.priority && <span className="doc-chip">{PRIORITY_LABEL[f.priority]}</span>}
                </div>
                {f.description && <p className="doc-obj__desc">{f.description}</p>}
                {(f.details ?? []).length > 0 && (
                  <ul className="doc-subbullets">
                    {f.details!.map((d, j) => (
                      <li key={j}>{d}</li>
                    ))}
                  </ul>
                )}
                {(f.examples ?? []).length > 0 && (
                  <p className="doc-eg">
                    <span className="doc-eg__lead">e.g.</span> {f.examples!.join(" · ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </DocSection>
      )}

      {(c.requirements ?? []).length > 0 && (
        <DocSection title="Functional Requirements">
          <Bullets items={c.requirements!} />
        </DocSection>
      )}

      {(c.pagesScreens ?? []).length > 0 && (
        <DocSection title="Pages & Screens">
          <ul className="doc-objlist">
            {c.pagesScreens!.map((p, i) => (
              <li key={i}>
                <div className="doc-obj__name">{p.name}</div>
                {p.description && <p className="doc-obj__desc">{p.description}</p>}
                {(p.displays ?? []).length > 0 && (
                  <ul className="doc-subbullets">
                    {p.displays!.map((d, j) => (
                      <li key={j}>{d}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </DocSection>
      )}

      {(c.successCriteria ?? []).length > 0 && (
        <DocSection title="Success Criteria">
          <ul className="doc-checks">
            {c.successCriteria!.map((s, i) => (
              <li key={i}>
                <span className="doc-check__mark">✓</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </DocSection>
      )}

      {(c.userStories ?? []).length > 0 && (
        <DocSection title="User Stories">
          <ul className="doc-stories">
            {c.userStories!.map((s, i) => (
              <li key={i}>
                <span className="doc-story__lead">As a</span> {s.asA || "—"}
                <span className="doc-story__lead">, I want</span> {s.iWant || "—"}
                <span className="doc-story__lead">, so that</span> {s.soThat || "—"}.
              </li>
            ))}
          </ul>
        </DocSection>
      )}

      {(c.nonFunctionalRequirements ?? []).length > 0 && (
        <DocSection title="Non-Functional Requirements">
          <Bullets items={c.nonFunctionalRequirements!} />
        </DocSection>
      )}

      {scopeLater.length > 0 && (
        <DocSection title="Scope — Later">
          <Bullets items={scopeLater} />
        </DocSection>
      )}

      {scopeLater.length === 0 && nonGoals.length > 0 && (
        <DocSection title="Non-Goals">
          <Bullets items={nonGoals} />
        </DocSection>
      )}

      {(c.dataModel ?? []).length > 0 && (
        <DocSection title="Data Model & Sources">
          <ul className="doc-flat">
            {c.dataModel!.map((d, i) => (
              <li key={i}>
                <span className="doc-obj__name">{d.data}</span>
                {d.direction && <span className="doc-muted"> · {d.direction}</span>}
                {d.source && <span className="doc-muted"> · from {d.source}</span>}
              </li>
            ))}
          </ul>
        </DocSection>
      )}

      {(c.integrations ?? []).length > 0 && (
        <DocSection title="Integrations & 3rd-Party Software">
          {integrationsEst && <DocEstimate />}
          <ul className="doc-flat doc-flat--cost">
            {c.integrations!.map((it, i) => (
              <li key={i}>
                <span>
                  <span className="doc-obj__name">{it.name}</span>
                  {it.purpose && <span className="doc-muted"> — {it.purpose}</span>}
                </span>
                <DocCost value={it.monthlyCost} estimated={it.estimated} />
              </li>
            ))}
          </ul>
        </DocSection>
      )}

      {(c.techStack ?? []).length > 0 && (
        <DocSection title="Tech Stack & Infrastructure">
          {stackEst && <DocEstimate />}
          {stackHasLayers ? (
            <div className="doc-stackgroups">
              {stackGroups.map((g) => (
                <div key={g.layer}>
                  <h4 className="doc-stack__head">{STACK_LABEL[g.layer]}</h4>
                  <ul className="doc-flat doc-flat--cost">
                    {g.items.map((it, i) => (
                      <li key={i}>
                        <span>
                          <span className="doc-obj__name">{it.name}</span>
                          {(it.includes ?? []).length > 0 && (
                            <ul className="doc-subbullets">
                              {it.includes!.map((inc, j) => (
                                <li key={j}>{inc}</li>
                              ))}
                            </ul>
                          )}
                        </span>
                        <DocCost value={it.monthlyCost} estimated={it.estimated} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <ul className="doc-flat doc-flat--cost">
              {c.techStack!.map((it, i) => (
                <li key={i}>
                  <span>
                    <span className="doc-obj__name">{it.name}</span>
                  </span>
                  <DocCost value={it.monthlyCost} estimated={it.estimated} />
                </li>
              ))}
            </ul>
          )}
        </DocSection>
      )}

      {(c.uxFlows ?? []).length > 0 && (
        <DocSection title="UX Flows">
          <ul className="doc-objlist">
            {c.uxFlows!.map((f, i) => (
              <li key={i}>
                <div className="doc-obj__name">{f.role}</div>
                <p className="doc-obj__desc">{f.flow}</p>
              </li>
            ))}
          </ul>
        </DocSection>
      )}

      {(c.assumptions ?? []).length > 0 && (
        <DocSection title="Assumptions & Dependencies">
          <Bullets items={c.assumptions!} />
        </DocSection>
      )}

      {hasCd && (
        <DocSection title="Constraints">
          <ul className="doc-flat">
            {cd.deadline && (
              <li>
                <span className="doc-muted">Must have by:</span> {cd.deadline}
              </li>
            )}
            {cd.budget && (
              <li>
                <span className="doc-muted">Budget:</span> {cd.budget}
              </li>
            )}
            {cd.branding && (
              <li>
                <span className="doc-muted">Branding:</span> {cd.branding}
              </li>
            )}
            {cd.security && (
              <li>
                <span className="doc-muted">Security:</span> {cd.security}
              </li>
            )}
          </ul>
        </DocSection>
      )}

      {!hasCd && constraintsList.length > 0 && (
        <DocSection title="Constraints">
          <Bullets items={constraintsList} />
        </DocSection>
      )}

      {(c.risks ?? []).length > 0 && (
        <DocSection title="Risks">
          <Bullets items={c.risks!} />
        </DocSection>
      )}

      {(c.openQuestions ?? []).length > 0 && (
        <DocSection title="Open Questions">
          <Bullets items={c.openQuestions!} />
        </DocSection>
      )}

      {milestoneList.length > 0 && (
        <DocSection title="Milestones">
          <ul className="doc-flat doc-flat--cost">
            {milestoneList.map((m, i) => (
              <li key={i}>
                <span>{m.label}</span>
                {m.dueDate && <span className="doc-muted">{m.dueDate}</span>}
              </li>
            ))}
          </ul>
        </DocSection>
      )}

      {milestoneList.length === 0 && c.milestones && (
        <DocSection title="Milestones">
          <p className="doc-prose">{c.milestones}</p>
        </DocSection>
      )}

      {(c.futureExpansion ?? []).length > 0 && (
        <DocSection title="Future Expansion Opportunities">
          <Bullets items={c.futureExpansion!} />
        </DocSection>
      )}
    </div>
  );
}
