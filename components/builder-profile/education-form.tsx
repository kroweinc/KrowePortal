"use client";

import { Input } from "@/components/ui/input";
import { SuggestInput } from "./suggest-input";
import { UNIVERSITY_NAMES, COMMON_MAJORS, findUniversityDomain } from "@/lib/education";
import { useProfileDraft } from "./profile-draft-context";

// Education editor — bound to the shared draft, autosaved (no Save button).
export function EducationForm() {
  const { draft, setField } = useProfileDraft();

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="bp-edu-school" className="block text-xs font-medium text-neutral-700">
          School
        </label>
        <SuggestInput
          id="bp-edu-school"
          value={draft.educationSchool}
          onChange={(v) => setField("educationSchool", v)}
          suggestions={UNIVERSITY_NAMES}
          maxLength={120}
          placeholder="e.g. University of Texas at Austin"
          logoDomain={findUniversityDomain}
        />
        <p className="text-[11px] text-neutral-400">
          Start typing to pick a university, or enter any school name.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="bp-edu-major" className="block text-xs font-medium text-neutral-700">
            Major
          </label>
          <SuggestInput
            id="bp-edu-major"
            value={draft.educationMajor}
            onChange={(v) => setField("educationMajor", v)}
            suggestions={COMMON_MAJORS}
            maxLength={120}
            placeholder="e.g. Computer Science"
          />
          <p className="text-[11px] text-neutral-400">Leave blank if high school.</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="bp-edu-year" className="block text-xs font-medium text-neutral-700">
            Year
          </label>
          <Input
            id="bp-edu-year"
            value={draft.educationYear}
            onChange={(e) => setField("educationYear", e.target.value)}
            maxLength={40}
            placeholder="e.g. Class of 2027"
          />
        </div>
      </div>
    </div>
  );
}
