"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SuggestInput } from "./suggest-input";
import { updateProfileBasics } from "@/lib/actions/builder-profile";
import { UNIVERSITY_NAMES, COMMON_MAJORS, findUniversityDomain } from "@/lib/education";

interface EducationFormProps {
  initialSchool: string;
  initialMajor: string;
  initialYear: string;
}

export function EducationForm({ initialSchool, initialMajor, initialYear }: EducationFormProps) {
  const [school, setSchool] = useState(initialSchool);
  const [major, setMajor] = useState(initialMajor);
  const [year, setYear] = useState(initialYear);
  const [saved, setSaved] = useState({
    school: initialSchool,
    major: initialMajor,
    year: initialYear,
  });
  const [isPending, startTransition] = useTransition();

  const dirty =
    school.trim() !== saved.school.trim() ||
    major.trim() !== saved.major.trim() ||
    year.trim() !== saved.year.trim();

  function save() {
    if (!dirty || isPending) return;
    startTransition(async () => {
      const result = await updateProfileBasics({
        education_school: school.trim(),
        education_major: major.trim(),
        education_year: year.trim(),
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setSaved({ school, major, year });
      toast.success("Saved");
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="bp-edu-school" className="block text-xs font-medium text-neutral-700">
          School
        </label>
        <SuggestInput
          id="bp-edu-school"
          value={school}
          onChange={setSchool}
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
            value={major}
            onChange={setMajor}
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
            value={year}
            onChange={(e) => setYear(e.target.value)}
            maxLength={40}
            placeholder="e.g. Class of 2027"
          />
        </div>
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={!dirty || isPending}>
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
