import type { ContractContent } from "@/lib/types";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</h3>
      {children}
    </section>
  );
}

function Para({ text }: { text: string }) {
  return <p className="text-sm leading-relaxed text-neutral-800 whitespace-pre-wrap">{text}</p>;
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="list-disc pl-5 space-y-1 text-sm text-neutral-800">
      {items.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ul>
  );
}

export function ContractView({ content }: { content: ContractContent }) {
  const deliverables = content.deliverables ?? [];
  const additionalTerms = content.additionalTerms ?? [];
  const parties = content.parties;

  return (
    <div className="space-y-7">
      {(parties?.provider || parties?.client || content.effectiveDate) && (
        <Section title="Parties">
          <div className="text-sm text-neutral-800 space-y-0.5">
            {parties?.provider && (
              <div>
                <span className="text-neutral-500">Provider:</span> {parties.provider}
              </div>
            )}
            {parties?.client && (
              <div>
                <span className="text-neutral-500">Client:</span> {parties.client}
              </div>
            )}
            {content.effectiveDate && (
              <div>
                <span className="text-neutral-500">Effective date:</span> {content.effectiveDate}
              </div>
            )}
          </div>
        </Section>
      )}

      {content.scopeOfServices && (
        <Section title="Scope of Services">
          <Para text={content.scopeOfServices} />
        </Section>
      )}

      {deliverables.length > 0 && (
        <Section title="Deliverables">
          <BulletList items={deliverables} />
        </Section>
      )}

      {content.fees && (
        <Section title="Fees">
          <Para text={content.fees} />
        </Section>
      )}

      {content.paymentTerms && (
        <Section title="Payment Terms">
          <Para text={content.paymentTerms} />
        </Section>
      )}

      {content.timeline && (
        <Section title="Timeline">
          <Para text={content.timeline} />
        </Section>
      )}

      {content.ipOwnership && (
        <Section title="Intellectual Property">
          <Para text={content.ipOwnership} />
        </Section>
      )}

      {content.confidentiality && (
        <Section title="Confidentiality">
          <Para text={content.confidentiality} />
        </Section>
      )}

      {content.warranties && (
        <Section title="Warranties">
          <Para text={content.warranties} />
        </Section>
      )}

      {content.liability && (
        <Section title="Limitation of Liability">
          <Para text={content.liability} />
        </Section>
      )}

      {content.termination && (
        <Section title="Termination">
          <Para text={content.termination} />
        </Section>
      )}

      {content.changeManagement && (
        <Section title="Change Management">
          <Para text={content.changeManagement} />
        </Section>
      )}

      {content.governingLaw && (
        <Section title="Governing Law">
          <Para text={content.governingLaw} />
        </Section>
      )}

      {additionalTerms.length > 0 && (
        <Section title="Additional Terms">
          <BulletList items={additionalTerms} />
        </Section>
      )}
    </div>
  );
}
