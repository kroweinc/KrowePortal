"use client";

/* Rail layout for the PRD dashboard — a sticky outline alongside the document,
   where every section is a framed card with an icon + title.
   Sections listed together in CARD_GROUPS share one card as side-by-side
   columns (Goals | Success Metrics). Scroll-spy runs off window scroll (the app
   has no nested scroll container — the document scrolls). */

import { useState, useRef, useEffect } from "react";
import {
  CircleCheck,
  ClipboardList,
  Coins,
  Database,
  File,
  FileText,
  Flag,
  Gauge,
  Goal,
  Handshake,
  Layers,
  ListOrdered,
  Lock,
  Puzzle,
  Rocket,
  Route,
  Server,
  Sparkles,
  User,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { PrdContent } from "@/lib/types";
import { isRefinable } from "@/lib/prd/section-fields";
import { SECTIONS, type SectionDef, type PrdPatch } from "./prd-sections";
import { useEditing } from "./inline-edit";

// Both offsets have to clear the app topbar + the sticky document header; they
// mirror --prd-anchor-offset in prd-dashboard.css.
const SPY_OFFSET = 160; // px from the top of the viewport that counts as "active"
const JUMP_OFFSET = 148; // scroll-margin so a jump lands below both bars

/** Section id → the glyph in its card head. Anything unmapped reads as prose. */
const SECTION_ICONS: Record<string, LucideIcon> = {
  overview: FileText,
  goals: CircleCheck,
  successMetrics: Goal,
  users: User,
  coreUserFlow: ListOrdered,
  features: Layers,
  requirements: ClipboardList,
  pagesScreens: File,
  successCriteria: CircleCheck,
  nonFunctionalRequirements: Gauge,
  scopeLater: FileText,
  futureExpansion: Rocket,
  dataModel: Database,
  integrations: Puzzle,
  techStack: Server,
  freeTierFit: Coins,
  uxFlows: Route,
  assumptions: Handshake,
  constraints: Lock,
  milestones: Flag,
};

/** Sections that share a single card, rendered as columns. The card takes its
    outline entry (and its scroll anchor) from the first member. */
const CARD_GROUPS: string[][] = [["goals", "successMetrics"]];

/** SECTIONS in document order, bundled into the cards they render as. */
function buildCards(): SectionDef[][] {
  const grouped = new Map<string, string[]>();
  for (const g of CARD_GROUPS) for (const id of g) grouped.set(id, g);

  const cards: SectionDef[][] = [];
  const done = new Set<string>();
  for (const s of SECTIONS) {
    if (done.has(s.id)) continue;
    const ids = grouped.get(s.id) ?? [s.id];
    const members = ids
      .map((id) => SECTIONS.find((x) => x.id === id))
      .filter((x): x is SectionDef => !!x);
    members.forEach((m) => done.add(m.id));
    cards.push(members);
  }
  return cards;
}

const CARDS = buildCards();

function SectionHead({
  section,
  onRefine,
}: {
  section: SectionDef;
  onRefine?: (sectionId: string) => void;
}) {
  const editing = useEditing();
  const Icon = SECTION_ICONS[section.id] ?? FileText;
  const showRefine = editing && onRefine && isRefinable(section.id);
  return (
    <div className="dash-section__head">
      <div className="flex items-start justify-between gap-3">
        <h2 className="dash-section__title">
          <span className="dash-section__icon" aria-hidden="true">
            <Icon className="h-4 w-4" />
          </span>
          {section.title}
        </h2>
        {showRefine && (
          <button
            type="button"
            className="prd-btn prd-sec-refine shrink-0"
            onClick={() => onRefine!(section.id)}
            title="Refine this section with AI"
          >
            <Sparkles className="h-3 w-3" />
            Refine
          </button>
        )}
      </div>
      {section.hint && <p className="dash-section__hint">{section.hint}</p>}
    </div>
  );
}

function SectionBody({
  section,
  content,
  patch,
}: {
  section: SectionDef;
  content: PrdContent;
  patch: PrdPatch;
}) {
  const { Body } = section;
  return <Body content={content} patch={patch} />;
}

function SectionCard({
  members,
  content,
  patch,
  innerRef,
  onRefine,
}: {
  members: SectionDef[];
  content: PrdContent;
  patch: PrdPatch;
  innerRef: (el: HTMLElement | null) => void;
  onRefine?: (sectionId: string) => void;
}) {
  const paired = members.length > 1;
  return (
    <section className="dash-section" ref={innerRef} data-section={members[0].id}>
      {paired ? (
        <>
          <div className="prd-cols">
            {members.map((s) => (
              <SectionHead key={s.id} section={s} onRefine={onRefine} />
            ))}
          </div>
          <div className="prd-cols">
            {members.map((s) => (
              <div className="dash-section__body" key={s.id}>
                <SectionBody section={s} content={content} patch={patch} />
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <SectionHead section={members[0]} onRefine={onRefine} />
          <div className="dash-section__body">
            <SectionBody section={members[0]} content={content} patch={patch} />
          </div>
        </>
      )}
    </section>
  );
}

export function PrdRail({
  content,
  patch,
  onRefine,
}: {
  content: PrdContent;
  patch: PrdPatch;
  onRefine?: (sectionId: string) => void;
}) {
  const [active, setActive] = useState(CARDS[0][0].id);
  const refs = useRef<Record<string, HTMLElement | null>>({});
  const setRef = (id: string) => (el: HTMLElement | null) => {
    refs.current[id] = el;
  };

  useEffect(() => {
    let raf: number | null = null;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        let cur = CARDS[0][0].id;
        for (const card of CARDS) {
          const el = refs.current[card[0].id];
          if (el && el.getBoundingClientRect().top <= SPY_OFFSET) cur = card[0].id;
        }
        setActive(cur);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const jump = (id: string) => {
    const el = refs.current[id];
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - JUMP_OFFSET;
    window.scrollTo({ top, behavior: "smooth" });
  };

  return (
    <div className="rail-layout">
      <nav className="toc" aria-label="Document outline">
        <div className="toc__nav">
          {CARDS.map((card) => (
            <button
              key={card[0].id}
              type="button"
              className={"toc__item" + (active === card[0].id ? " is-active" : "")}
              onClick={() => jump(card[0].id)}
            >
              {card[0].title}
            </button>
          ))}
        </div>
      </nav>
      <div className="rail-content">
        {CARDS.map((card) => (
          <SectionCard
            key={card[0].id}
            members={card}
            content={content}
            patch={patch}
            innerRef={setRef(card[0].id)}
            onRefine={onRefine}
          />
        ))}
      </div>
    </div>
  );
}
