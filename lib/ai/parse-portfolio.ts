import { runChat, AI_MODEL } from "./client";
import { normalizeUrl, githubProfileUrl } from "@/lib/project/business-context";

export interface ParsedPortfolioExperience {
  role: string;
  company: string;
  start_label: string;
  end_label: string;
  description: string;
}

export interface ParsedPortfolioProject {
  name: string;
  description: string;
  url: string;
  live_url: string;
  tech: string[];
}

export interface ParsedPortfolio {
  headline: string;
  bio: string;
  linkedin_url: string;
  github_url: string;
  education_school: string;
  education_major: string;
  education_year: string;
  experience: ParsedPortfolioExperience[];
  projects: ParsedPortfolioProject[];
}

const MAX_EXPERIENCE = 15;
const MAX_PROJECTS = 12;

const SYSTEM_PROMPT = `You are extracting structured profile data from the text of a software builder's personal portfolio website so it can populate their public builder profile.

Extract ONLY what the site actually says. Do NOT invent employers, schools, dates, links, or projects. If a field isn't on the site, use an empty string (or empty array).

Output ONLY valid JSON in this exact shape:

{
  "headline": "A one-line professional headline (max 120 chars), e.g. 'Full-stack engineer · React, Node, Postgres'. Derive from their title/intro.",
  "bio": "A 2-4 sentence first-person summary of who they are and what they build, grounded in the site's about/intro content. Plain prose, no bullet points.",
  "linkedin_url": "Their LinkedIn profile URL if linked on the site, else ''",
  "github_url": "Their GitHub profile URL if linked on the site, else ''",
  "education_school": "School/university name (max 120 chars, '' if absent)",
  "education_major": "Major or field of study (max 120 chars, '' if absent)",
  "education_year": "Graduation year or class label, e.g. 'Class of 2027' (max 40 chars, '' if absent)",
  "experience": [
    {
      "role": "Job title exactly as written (max 120 chars)",
      "company": "Employer name (max 120 chars)",
      "start_label": "Start date as a short label, e.g. 'Mar 2022' or '2021' (max 40 chars, '' if absent)",
      "end_label": "End date label, '' if current/Present",
      "description": "1-3 sentence summary of what they did there (max 1000 chars)"
    }
  ],
  "projects": [
    {
      "name": "Project name (max 120 chars)",
      "description": "1-3 sentence summary of what the project is and does (max 1000 chars)",
      "url": "Source/repo or project detail URL if shown, else ''",
      "live_url": "Deployed demo/live URL if shown and distinct from url, else ''",
      "tech": ["up to 12 technologies the site names for this project"]
    }
  ]
}

Rules:
- URLs in the text appear in parentheses after link text; copy them exactly as written.
- github_url must be the person's profile (github.com/<username>), not a repository link.
- Do NOT list the portfolio site itself as a project.
- Do NOT duplicate the same project under multiple names.
- Do NOT include education or standalone projects as experience entries.
- An empty field is correct when the site doesn't cover it; a fabricated one is a failure.`;

const clamp = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

/**
 * Sanitize an AI-extracted project/site URL: resolve root-relative paths
 * against the portfolio's base URL, then require plain http(s).
 */
function cleanSiteUrl(raw: unknown, baseUrl: string): string {
  if (typeof raw !== "string") return "";
  let candidate = raw.trim();
  if (!candidate) return "";
  if (candidate.startsWith("/")) {
    try {
      candidate = new URL(candidate, baseUrl).href;
    } catch {
      return "";
    }
  }
  const normalized = normalizeUrl(candidate);
  return normalized ? normalized.slice(0, 500) : "";
}

// Same host requirement updateProfileBasics enforces on builder-typed links.
function cleanProfileLink(raw: unknown, hostPattern: RegExp): string {
  const normalized = typeof raw === "string" ? normalizeUrl(raw) : null;
  return normalized && hostPattern.test(normalized) ? normalized.slice(0, 500) : "";
}

export async function parsePortfolio(
  siteText: string,
  baseUrl: string,
  userId: string
): Promise<ParsedPortfolio | null> {
  let parsed: Record<string, unknown>;
  try {
    const response = await runChat(
      {
        model: AI_MODEL,
        max_completion_tokens: 6000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Portfolio site: ${baseUrl}\n\n${siteText}` },
        ],
      },
      { userId, operation: "import_portfolio" }
    );
    parsed = JSON.parse(response.choices[0]?.message?.content ?? "{}") as Record<string, unknown>;
  } catch (err) {
    console.error("[parsePortfolio] AI call failed", err);
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
    .filter((e) => e.role && e.company)
    .slice(0, MAX_EXPERIENCE);

  const projects = (Array.isArray(parsed.projects) ? parsed.projects : [])
    .map((p: Record<string, unknown>) => {
      const url = cleanSiteUrl(p?.url, baseUrl);
      let liveUrl = cleanSiteUrl(p?.live_url, baseUrl);
      if (liveUrl && liveUrl === url) liveUrl = "";
      const tech = (Array.isArray(p?.tech) ? p.tech : [])
        .map((t: unknown) => clamp(t, 40))
        .filter(Boolean);
      return {
        name: clamp(p?.name, 120),
        description: clamp(p?.description, 1000),
        url,
        live_url: liveUrl,
        tech: [...new Set(tech)].slice(0, 12),
      };
    })
    .filter((p) => p.name)
    .slice(0, MAX_PROJECTS);

  return {
    headline: clamp(parsed.headline, 120),
    bio: clamp(parsed.bio, 2000),
    linkedin_url: cleanProfileLink(parsed.linkedin_url, /linkedin\.com\//i),
    github_url: cleanProfileLink(
      typeof parsed.github_url === "string" ? githubProfileUrl(parsed.github_url) : "",
      /github\.com\//i
    ),
    education_school: clamp(parsed.education_school, 120),
    education_major: clamp(parsed.education_major, 120),
    education_year: clamp(parsed.education_year, 40),
    experience,
    projects,
  };
}
