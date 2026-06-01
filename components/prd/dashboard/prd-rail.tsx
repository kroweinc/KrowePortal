"use client";

/* Rail layout for the PRD dashboard — a sticky table-of-contents with
   scroll-spy alongside the full section list. Rewired to window scroll (the
   app has no nested scroll container — the document scrolls). */

import { useState, useRef, useEffect } from "react";
import { Sparkles } from "lucide-react";
import type { PrdContent } from "@/lib/types";
import { isRefinable } from "@/lib/prd/section-fields";
import { SECTIONS, type SectionDef, type PrdPatch } from "./prd-sections";
import { useEditing } from "./inline-edit";

const SPY_OFFSET = 140; // px from the top of the viewport that counts as "active"
const JUMP_OFFSET = 96; // scroll-margin so a jump lands below the header

function SectionBlock({
  section,
  content,
  patch,
  innerRef,
  onRefine,
}: {
  section: SectionDef;
  content: PrdContent;
  patch: PrdPatch;
  innerRef: (el: HTMLElement | null) => void;
  onRefine?: (sectionId: string) => void;
}) {
  const { Body } = section;
  const editing = useEditing();
  const showRefine = editing && onRefine && isRefinable(section.id);
  return (
    <section className="dash-section" ref={innerRef} data-section={section.id}>
      <div className="dash-section__head">
        <div className="flex items-start justify-between gap-3">
          <h2 className="dash-section__title">
            {section.num && <span className="dash-section__num">{section.num}.</span>} {section.title}
          </h2>
          {showRefine && (
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-500 transition hover:border-neutral-300 hover:text-neutral-800"
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
      <div className="dash-section__body">
        <Body content={content} patch={patch} />
      </div>
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
  const [active, setActive] = useState(SECTIONS[0].id);
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
        let cur = SECTIONS[0].id;
        for (const s of SECTIONS) {
          const el = refs.current[s.id];
          if (el && el.getBoundingClientRect().top <= SPY_OFFSET) cur = s.id;
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
      <nav className="toc">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={"toc__item" + (active === s.id ? " is-active" : "")}
            onClick={() => jump(s.id)}
          >
            <span className="toc__num">{s.num || "·"}</span>
            <span className="toc__label">{s.title}</span>
          </button>
        ))}
      </nav>
      <div className="rail-content">
        {SECTIONS.map((s) => (
          <SectionBlock
            key={s.id}
            section={s}
            content={content}
            patch={patch}
            innerRef={setRef(s.id)}
            onRefine={onRefine}
          />
        ))}
      </div>
    </div>
  );
}
