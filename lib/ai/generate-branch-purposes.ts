import { openai, AI_MODEL } from "./client";

const MAX_BRANCHES_PER_CALL = 60;

export type BranchPurposeInput = {
  name: string;
  latestCommitMessage: string | null;
};

export type BranchPurposeResult = {
  byBranch: Record<string, string>;
  model: string;
};

const SYSTEM_PROMPT = `You write one-sentence purposes for git branches.

For each branch, infer what the branch is for from its name and its latest commit subject. Be concrete — describe the work happening on the branch, not generic phrases like "this branch is...".

Examples of good outputs:
- "Adds GitHub OAuth flow for builder accounts"
- "Fixes the task estimate range calculation"
- "Production code; main release line"
- "Integration branch where features merge before main"

Keep each purpose under 90 characters. Output only valid JSON matching the schema:
{ "purposes": { "<branch-name>": "<sentence>", ... } }

Include every branch from the input in the output map.`;

function buildUserPrompt(repoFullName: string, inputs: BranchPurposeInput[]): string {
  const list = inputs.map((b) => ({
    name: b.name,
    latest_commit: b.latestCommitMessage ?? "(no commit info available)",
  }));
  return [
    `Repository: ${repoFullName}`,
    `Branches:`,
    JSON.stringify(list, null, 2),
  ].join("\n");
}

async function callOnce(
  repoFullName: string,
  inputs: BranchPurposeInput[]
): Promise<Record<string, string>> {
  if (inputs.length === 0) return {};

  const requestRaw = async (): Promise<string> => {
    const response = await openai.chat.completions.create({
      model: AI_MODEL,
      max_completion_tokens: 900,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(repoFullName, inputs) },
      ],
    });
    return response.choices[0]?.message?.content ?? "";
  };

  // json_object very occasionally returns non-JSON (or truncates); resample once
  // before failing — the model reliably self-corrects.
  const parsePurposes = (raw: string): Record<string, unknown> | null => {
    try {
      return (JSON.parse(raw) as { purposes?: Record<string, unknown> }).purposes ?? {};
    } catch {
      return null;
    }
  };

  const purposes = parsePurposes(await requestRaw()) ?? parsePurposes(await requestRaw());
  if (!purposes) {
    throw new Error("Branch purposes: AI returned non-JSON");
  }

  const out: Record<string, string> = {};
  for (const input of inputs) {
    const val = purposes[input.name];
    if (typeof val === "string" && val.length > 0) {
      out[input.name] = val.length > 200 ? val.slice(0, 200) : val;
    }
  }
  return out;
}

export async function generateBranchPurposes(
  repoFullName: string,
  inputs: BranchPurposeInput[]
): Promise<BranchPurposeResult> {
  const byBranch: Record<string, string> = {};

  for (let i = 0; i < inputs.length; i += MAX_BRANCHES_PER_CALL) {
    const chunk = inputs.slice(i, i + MAX_BRANCHES_PER_CALL);
    const result = await callOnce(repoFullName, chunk);
    Object.assign(byBranch, result);
  }

  return { byBranch, model: AI_MODEL };
}
