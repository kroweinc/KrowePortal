import { describe, expect, it } from "vitest";
import {
  transcriptToPlainText,
  splitTranscript,
  locateQuotes,
  splitOnQuote,
} from "@/lib/granola/transcript-view";

describe("splitTranscript (reading back what transcriptToPlainText wrote)", () => {
  it("round-trips real transcriptToPlainText output", () => {
    // Built by the actual writer, so the parser can't drift from the format.
    const raw = transcriptToPlainText([
      { text: "So the main thing is the intake form.", speaker: { source: "microphone" } },
      { text: "We need it before August.", speaker: { diarization_label: "Rahul" } },
      { text: "Right, and billing after that.", speaker: { diarization_label: "Rahul" } },
    ]);

    expect(splitTranscript(raw)).toEqual([
      { speaker: "Me", text: "So the main thing is the intake form." },
      // Consecutive same-speaker segments merge into one paragraph upstream.
      { speaker: "Rahul", text: "We need it before August. Right, and billing after that." },
    ]);
  });

  it("passes a single unlabeled segment through with no speaker", () => {
    const raw = transcriptToPlainText([{ text: "Just a plain text transcript.", speaker: null }]);
    expect(splitTranscript(raw)).toEqual([
      { speaker: null, text: "Just a plain text transcript." },
    ]);
  });

  it("does not mistake a mid-sentence colon for a speaker", () => {
    const lines = splitTranscript("So here is the thing: we need the intake form live.");
    expect(lines).toEqual([
      { speaker: null, text: "So here is the thing: we need the intake form live." },
    ]);
  });

  it("does not treat a long prefix as a speaker label", () => {
    // Over the 40-char cap, so it reads as prose rather than "Speaker: text".
    const long = "A very long introductory clause that runs well past the cap: and then some";
    expect(splitTranscript(long)[0].speaker).toBeNull();
  });

  it("still reads a multi-word diarization label as the speaker", () => {
    // The reason the guard counts words rather than banning spaces outright.
    const lines = splitTranscript("Steven Ortega: We should rebuild the intake form.");
    expect(lines[0]).toEqual({
      speaker: "Steven Ortega",
      text: "We should rebuild the intake form.",
    });
  });
});

describe("locateQuotes (anchoring a task's quote into the transcript)", () => {
  const lines = splitTranscript(
    "Me: We should rebuild the intake form.\n\nRahul: And migrate billing to Stripe.\n\nMe: Nothing else for now."
  );

  it("anchors an exact quote to its line", () => {
    const anchors = locateQuotes(lines, [{ taskId: "t1", quote: "migrate billing to Stripe" }]);
    expect(anchors.get(1)).toEqual(["t1"]);
  });

  it("matches through curly quotes and collapsed whitespace", () => {
    const anchors = locateQuotes(lines, [
      { taskId: "t1", quote: "rebuild   the\n intake form" },
    ]);
    expect(anchors.get(0)).toEqual(["t1"]);
  });

  it("groups several tasks that came from one line", () => {
    const anchors = locateQuotes(lines, [
      { taskId: "t1", quote: "migrate billing" },
      { taskId: "t2", quote: "billing to Stripe" },
    ]);
    expect(anchors.get(1)).toEqual(["t1", "t2"]);
  });

  it("anchors a quote spanning lines by its first 60 chars", () => {
    // The probe only earns its keep when the quote is LONGER than one line:
    // here the model quoted across the paragraph break, so the full needle
    // matches nothing but its first 60 chars sit entirely on line 0.
    const spanning = splitTranscript(
      "Me: We should rebuild the intake form before the August deadline hits.\n\nRahul: Agreed."
    );
    const anchors = locateQuotes(spanning, [
      {
        taskId: "t1",
        quote: "We should rebuild the intake form before the August deadline hits. Agreed.",
      },
    ]);
    expect(anchors.get(0)).toEqual(["t1"]);
  });

  it("skips a quote it cannot find rather than guessing a line", () => {
    // No token-coverage fallback on purpose: a near-miss would put the
    // highlight on the wrong sentence and lie about where the task came from.
    const anchors = locateQuotes(lines, [
      { taskId: "t1", quote: "something nobody said on this call" },
    ]);
    expect(anchors.size).toBe(0);
  });

  it("skips null and too-short quotes", () => {
    const anchors = locateQuotes(lines, [
      { taskId: "t1", quote: null },
      { taskId: "t2", quote: "the" },
    ]);
    expect(anchors.size).toBe(0);
  });
});

describe("splitOnQuote (slicing the hit back out of the original text)", () => {
  it("returns the original casing and punctuation, not the normalized form", () => {
    const parts = splitOnQuote("We should rebuild the Intake Form soon.", "rebuild the intake form");
    expect(parts).toEqual({
      before: "We should ",
      hit: "rebuild the Intake Form",
      after: " soon.",
    });
  });

  it("maps back correctly across collapsed whitespace", () => {
    const parts = splitOnQuote("We   should\nrebuild it.", "should rebuild");
    expect(parts?.hit).toBe("should\nrebuild");
    expect(parts?.before).toBe("We   ");
    expect(parts?.after).toBe(" it.");
  });

  it("matches through curly quotes without shifting the slice", () => {
    const parts = splitOnQuote("He said “ship it” on Friday.", 'said "ship it"');
    expect(parts?.hit).toBe("said “ship it”");
  });

  it("returns null when the quote is not in the line", () => {
    expect(splitOnQuote("We should rebuild the intake form.", "migrate billing")).toBeNull();
    expect(splitOnQuote("Anything", null)).toBeNull();
  });
});
