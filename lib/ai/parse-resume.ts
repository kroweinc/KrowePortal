import { runChat, AI_MODEL } from "./client";
import type { AiCallMeta } from "./usage";

export interface ParsedResumeExperience {
  role: string;
  company: string;
  start_label: string;
  end_label: string;
  description: string;
}

export interface ParsedResume {
  headline: string;
  bio: string;
  experience: ParsedResumeExperience[];
}

const SYSTEM_PROMPT = `You are extracting structured profile data from a software builder's resume PDF so it can populate their public builder profile.

Extract ONLY what the resume actually says. Do NOT invent employers, dates, titles, or accomplishments. If a field isn't in the resume, leave it as an empty string.

Output ONLY valid JSON in this exact shape:

{
  "headline": "A one-line professional headline (max 120 chars), e.g. 'Full-stack engineer · React, Node, Postgres'. Derive from their title/summary/skills.",
  "bio": "A 2-4 sentence first-person summary of who they are and what they build, grounded in the resume's summary, skills, and strongest experience. Plain prose, no bullet points.",
  "experience": [
    {
      "role": "Job title exactly as written (max 120 chars)",
      "company": "Employer name (max 120 chars)",
      "start_label": "Start date as a short label, e.g. 'Mar 2022' or '2021' (max 40 chars, '' if absent)",
      "end_label": "End date label, '' if current/Present",
      "description": "1-3 sentence summary of what they did there, condensed from the bullets (max 1000 chars)"
    }
  ]
}

Rules:
- List experience in the same order as the resume (most recent first).
- Include internships, freelance, and contract work as experience entries.
- Do NOT include education, certifications, or standalone projects as experience entries.
- Condense bullet lists into flowing sentences; keep concrete numbers and technologies.
- An empty field is correct when the resume doesn't cover it; a fabricated one is a failure.`;

const clamp = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

export async function parseResume(
  pdfBase64: string,
  fileName: string,
  meta?: AiCallMeta
): Promise<ParsedResume | null> {
  let parsed: Record<string, unknown>;
  try {
    const response = await runChat({
      model: AI_MODEL,
      max_completion_tokens: 4000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "file",
              file: {
                filename: fileName,
                file_data: `data:application/pdf;base64,${pdfBase64}`,
              },
            },
            { type: "text", text: "Extract the profile data from this resume." },
          ],
        },
      ],
    }, meta);
    parsed = JSON.parse(response.choices[0]?.message?.content ?? "{}") as Record<string, unknown>;
  } catch (err) {
    console.error("[parseResume] AI call failed", err);
    return null;
  }

  const experience = (Array.isArray(parsed.experience) ? parsed.experience : [])
    .map((e: Record<string, unknown>) => ({
      role: clamp(e?.role, 120),
      company: clamp(e?.company, 120),
      start_label: clamp(e?.start_label, 40),
      end_label: clamp(e?.end_label, 40),
      description: clamp(e?.description, 1000),
    }))
    .filter((e) => e.role && e.company);

  return {
    headline: clamp(parsed.headline, 120),
    bio: clamp(parsed.bio, 2000),
    experience,
  };
}
