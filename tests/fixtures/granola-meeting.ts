import type { ExtractedTaskDraft } from "@/lib/ai/schemas";

// ── Fixture: the Granola-generated meeting notes ─────────────────────────────

export const MEETING_NOTES = `## Action items

- Steven: clean up agent credential notes and spreadsheet; remove outdated temp passwords; make unset passwords permanent.
- Steven: add device tracking to Agent Monitoring.
- Steven: migrate MyPG Drive file storage to AWS, then push it live.
- Steven: update MyPG Drive display to remove cause number and show plaintiff, read from the document.
- Steven: push Pending Matters live and apply the agreed column cleanup.
- Steven: push the Case Status Call Sheet live.
- Steven: connect lawsuit submission portal file uploads/email flow to AWS, then push live.
- Steven: update reminder email logic and copy:
  - replace “please advise” with “please review your agent action item”
  - make deadline 7 days from send date
  - use the month-based +90 day window logic
  - add “Client declined” option to suppress expert reminders
  - CC protest@patelgaines.com on outgoing reminders.
- Steven: record video walkthroughs for PG Drive and the Case Status Call Sheet; save them in the master portal.
- Steven: update “established” year from 2014 to 2013 everywhere.
- Steven: send his hours to Rahul.
- Rahul: send Steven the call sheet template / lawsuit takeover sheet for field cleanup and docket-sheet follow-up.
- Rahul: forward the lawsuit submission link to Chris Stanton first as a limited test once live.
- Kathleen: monitor the July 6 reminder-email send and flag any issues.
- Maria: mark lawsuit submissions approved and add them to the spreadsheet once filed.
`;

// A transcript slice restating a couple of commitments — exercises the
// reconstruction fallback for the paste/upload shape ({ summary: null }).
export const MEETING_TRANSCRIPT = `Me: I'll get the established year fixed, it should say 2013 not 2014.
Them: Perfect, it's on the About page and the footer.
Me: And I'll send my hours over to Rahul before Friday.
Them: Sounds good.
Them: Kathleen can watch the July 6 reminder send and flag anything weird.`;

export const OPTIONS = { notes: MEETING_NOTES, builderAliases: ["Steven Ortega"] };

/** What the model emits AFTER sourceText was removed from the wire schema
    (ModelExtractedTaskDraft): same drafts, no sourceText, with sourceQuote
    carrying the verbatim grounding. Every fixture sourceText is a single
    bullet ≤300 chars, so moving it into sourceQuote stays schema-valid. */
export function withoutSourceText(items: ExtractedTaskDraft[]): ExtractedTaskDraft[] {
  return items.map(({ sourceText, ...rest }) => ({
    ...rest,
    sourceQuote: rest.sourceQuote ?? sourceText?.slice(0, 300),
  }));
}

export function draft(
  d: Partial<ExtractedTaskDraft> & Pick<ExtractedTaskDraft, "title" | "description">
): ExtractedTaskDraft {
  return {
    priority: "medium",
    type: "change",
    tags: [],
    checklist: [],
    dependencies: [],
    confidence: "high",
    ...d,
  };
}

// A faithful extraction: one task per assigned bullet, all owners, checklists
// preserved. The post-processor must pass this through without damage.
export function goodModelOutput(): ExtractedTaskDraft[] {
  return [
    draft({
      title: "Clean up agent credential notes and spreadsheet",
      description: "Tidy the agent credential notes and the credentials spreadsheet.",
      owner: "builder",
      checklist: ["Remove outdated temporary passwords", "Make unset passwords permanent"],
      sourceText:
        "- Steven: clean up agent credential notes and spreadsheet; remove outdated temp passwords; make unset passwords permanent.",
    }),
    draft({
      title: "Add device tracking to Agent Monitoring",
      description: "Add device tracking to the Agent Monitoring page.",
      owner: "builder",
      sourceText: "- Steven: add device tracking to Agent Monitoring.",
    }),
    draft({
      title: "Migrate MyPG Drive file storage to AWS and launch it",
      description: "Move MyPG Drive file storage over to AWS, then push the updated system live.",
      owner: "builder",
      checklist: ["Migrate file storage to AWS", "Push the updated system live"],
      sourceText: "- Steven: migrate MyPG Drive file storage to AWS, then push it live.",
    }),
    draft({
      title: "Update the MyPG Drive case display",
      description:
        "Change the MyPG Drive case display: remove the cause number and show the plaintiff instead, reading the plaintiff name from the document.",
      owner: "builder",
      checklist: [
        "Remove the cause number",
        "Display the plaintiff",
        "Read the plaintiff name from the document",
      ],
      sourceText:
        "- Steven: update MyPG Drive display to remove cause number and show plaintiff, read from the document.",
    }),
    draft({
      title: "Launch Pending Matters with the agreed column cleanup",
      description: "Apply the agreed column cleanup to Pending Matters and push it live.",
      owner: "builder",
      checklist: ["Apply the agreed column cleanup", "Push Pending Matters live"],
      sourceText: "- Steven: push Pending Matters live and apply the agreed column cleanup.",
    }),
    draft({
      title: "Launch the Case Status Call Sheet",
      description: "Push the Case Status Call Sheet live.",
      owner: "builder",
      sourceText: "- Steven: push the Case Status Call Sheet live.",
    }),
    draft({
      title: "Connect lawsuit submission uploads and email flow to AWS",
      description:
        "Connect the lawsuit submission portal's file uploads and email flow to AWS, then push the updated portal live.",
      owner: "builder",
      checklist: [
        "Move file uploads to AWS",
        "Connect the related email flow",
        "Push the updated portal live",
      ],
      sourceText:
        "- Steven: connect lawsuit submission portal file uploads/email flow to AWS, then push live.",
      dependencies: [],
    }),
    draft({
      title: "Update reminder email logic and copy",
      description: "Rework the agent reminder email content and scheduling logic.",
      owner: "builder",
      checklist: [
        "Replace “please advise” with “please review your agent action item”",
        "Set the deadline to 7 days from the send date",
        "Use the month-based +90-day window logic",
        "Add a “Client declined” option that suppresses expert reminders",
        "CC protest@patelgaines.com on outgoing reminders",
      ],
      sourceText: "- Steven: update reminder email logic and copy:",
    }),
    draft({
      title: "Record and save portal walkthrough videos",
      description:
        "Record video walkthroughs for PG Drive and the Case Status Call Sheet and save them in the master portal.",
      owner: "builder",
      checklist: [
        "Record a PG Drive walkthrough",
        "Record a Case Status Call Sheet walkthrough",
        "Save both videos in the master portal",
      ],
      sourceText:
        "- Steven: record video walkthroughs for PG Drive and the Case Status Call Sheet; save them in the master portal.",
    }),
    draft({
      title: "Update the established year from 2014 to 2013 everywhere",
      description: "Change the “established” year from 2014 to 2013 across the portal.",
      owner: "builder",
      sourceText: "- Steven: update “established” year from 2014 to 2013 everywhere.",
    }),
    draft({
      title: "Send hours to Rahul",
      description: "Send worked hours over to Rahul.",
      owner: "builder",
      sourceText: "- Steven: send his hours to Rahul.",
    }),
    draft({
      title: "Send Steven the call sheet template and lawsuit takeover sheet",
      description:
        "Send the call sheet template / lawsuit takeover sheet for field cleanup and docket-sheet follow-up.",
      owner: "Rahul",
      sourceText:
        "- Rahul: send Steven the call sheet template / lawsuit takeover sheet for field cleanup and docket-sheet follow-up.",
    }),
    draft({
      title: "Forward the lawsuit submission link to Chris Stanton",
      description: "Once live, forward the lawsuit submission link to Chris Stanton as a limited test.",
      owner: "Rahul",
      sourceText:
        "- Rahul: forward the lawsuit submission link to Chris Stanton first as a limited test once live.",
    }),
    draft({
      title: "Monitor the July 6 reminder-email send",
      description: "Watch the July 6 reminder-email send and flag any issues.",
      owner: "Kathleen",
      sourceText: "- Kathleen: monitor the July 6 reminder-email send and flag any issues.",
    }),
    draft({
      title: "Mark lawsuit submissions approved and add them to the spreadsheet",
      description: "Once filed, mark lawsuit submissions approved and add them to the spreadsheet.",
      owner: "Maria",
      sourceText:
        "- Maria: mark lawsuit submissions approved and add them to the spreadsheet once filed.",
    }),
  ];
}

// A degraded extraction with every historical failure mode at once:
//  - the MyPG Drive display task is missing entirely
//  - Rahul's template-send became a builder task ("Review sample docket sheet…")
//  - the Case Status Call Sheet task appears twice
//  - the reminder-email task lost 2 of its 5 requirements
//  - the credential task lost both of its requirements
//  - the Pending Matters task lost the column-cleanup requirement
//  - one owner is written as "Steven" instead of "builder"
export function degradedModelOutput(): ExtractedTaskDraft[] {
  const good = goodModelOutput();
  return [
    draft({
      title: "Clean up agent credential notes and spreadsheet",
      description: "Tidy up the credential notes and spreadsheet.",
      owner: "builder",
      checklist: [],
      sourceText:
        "- Steven: clean up agent credential notes and spreadsheet; remove outdated temp passwords; make unset passwords permanent.",
    }),
    good[1],
    good[2],
    // good[3] (MyPG Drive display) omitted — the "completely missed task"
    draft({
      title: "Launch Pending Matters",
      description: "Push Pending Matters live.",
      owner: "builder",
      checklist: [],
      sourceText: "- Steven: push Pending Matters live and apply the agreed column cleanup.",
    }),
    draft({
      title: "Push the Case Status Call Sheet live",
      description: "Push the Case Status Call Sheet live.",
      owner: "builder",
      sourceText: "- Steven: push the Case Status Call Sheet live.",
    }),
    // duplicate of the previous deliverable, different wording
    draft({
      title: "Launch the Case Status Call Sheet",
      description: "Take the Case Status Call Sheet live for the team.",
      owner: "builder",
      sourceText: "- Steven: push the Case Status Call Sheet live.",
    }),
    good[6],
    draft({
      title: "Update reminder email logic and copy",
      description: "Rework the agent reminder email content and scheduling logic.",
      owner: "builder",
      checklist: [
        "Replace “please advise” with “please review your agent action item”",
        "Use the month-based +90 day window logic",
        "Add a “Client declined” option to suppress expert reminders",
      ],
      sourceText: "- Steven: update reminder email logic and copy:",
    }),
    good[8],
    good[9],
    // owner written as a name instead of 'builder'
    draft({ ...good[10], owner: "Steven" }),
    // Rahul's action item misattributed to the builder as an inferred task
    draft({
      title: "Review sample docket sheet for fields to pull",
      description: "Review the sample docket sheet to decide which fields to pull.",
      owner: "builder",
      sourceQuote:
        "Rahul: send Steven the call sheet template / lawsuit takeover sheet for field cleanup and docket-sheet follow-up.",
    }),
    good[11],
    good[12],
    good[13],
    good[14],
  ];
}
