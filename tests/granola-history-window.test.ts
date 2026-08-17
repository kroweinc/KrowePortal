import { describe, expect, it, vi, afterEach } from "vitest";
import { GRANOLA_HISTORY_DAYS, isBeyondGranolaHistory } from "@/lib/granola/format";
import {
  absentTranscriptCopy,
  canRetrySnapshot,
} from "@/components/granola/meeting-parts";
import type { GranolaMeetingDetail } from "@/lib/actions/granola-meetings";

/**
 * The 30-day window decides what the meeting surfaces are allowed to promise.
 * Measured against a live connection on 2026-08-10: notes 13, 18 and 29 days
 * old came back, 31, 32, 49 and 66 raised GranolaNotFoundError — so past the
 * edge there is nothing to fetch and no retry that can ever succeed.
 */

const NOW = Date.parse("2026-08-10T20:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

function meeting(over: Partial<GranolaMeetingDetail> = {}): GranolaMeetingDetail {
  return {
    id: "i1",
    engagementId: "e1",
    engagementTitle: "Client",
    title: "Call",
    callAt: daysAgo(3),
    importedAt: daysAgo(3),
    participants: null,
    summary: null,
    transcript: null,
    transcriptStatus: "failed",
    capturePending: false,
    tasks: [],
    ...over,
  };
}

afterEach(() => vi.useRealTimers());
const at = (iso = NOW) => vi.useFakeTimers({ now: iso, toFake: ["Date"] });

describe("isBeyondGranolaHistory", () => {
  it("brackets the measured edge: 29 days in, 31 days out", () => {
    at();
    expect(isBeyondGranolaHistory(daysAgo(29))).toBe(false);
    expect(isBeyondGranolaHistory(daysAgo(31))).toBe(true);
  });

  it("treats the boundary day itself as still reachable", () => {
    at();
    expect(isBeyondGranolaHistory(daysAgo(GRANOLA_HISTORY_DAYS))).toBe(false);
  });

  it("says nothing about a call with no date — an unknown age is not an old one", () => {
    at();
    expect(isBeyondGranolaHistory(null)).toBe(false);
    expect(isBeyondGranolaHistory("not a date")).toBe(false);
  });
});

describe("canRetrySnapshot", () => {
  it("offers a retry for the two outcomes asking again could change", () => {
    at();
    expect(canRetrySnapshot(meeting({ transcriptStatus: "failed" }))).toBe(true);
    expect(canRetrySnapshot(meeting({ transcriptStatus: "not_ready" }))).toBe(true);
  });

  it("withholds it where no button can help", () => {
    at();
    // A billing fact, a capture already running, and a call already captured.
    expect(canRetrySnapshot(meeting({ transcriptStatus: "plan_gated" }))).toBe(false);
    expect(canRetrySnapshot(meeting({ capturePending: true }))).toBe(false);
    expect(canRetrySnapshot(meeting({ transcriptStatus: "captured" }))).toBe(false);
  });

  it("withholds it past the window even when the last attempt failed", () => {
    at();
    // The trap this guards: an aged-out call stamps `failed`, which on its own
    // reads as "temporary — try again", and the retry can only 404 forever.
    expect(canRetrySnapshot(meeting({ transcriptStatus: "failed", callAt: daysAgo(31) }))).toBe(
      false
    );
  });
});

describe("absentTranscriptCopy", () => {
  it("leads with the window, ahead of a status that would mislead", () => {
    at();
    const copy = absentTranscriptCopy(
      meeting({ transcriptStatus: "failed", callAt: daysAgo(60) })
    );
    expect(copy).toContain(`last ${GRANOLA_HISTORY_DAYS} days`);
    expect(copy).not.toContain("couldn't be reached");
  });

  it("does not promise a read for an old import that never captured", () => {
    at();
    // capturePending would otherwise say "reload in a moment" — for a call
    // whose fetch is guaranteed to 404.
    const copy = absentTranscriptCopy(
      meeting({ transcriptStatus: null, capturePending: true, callAt: daysAgo(90) })
    );
    expect(copy).not.toContain("reload in a moment");
    expect(copy).toContain("no longer be fetched");
  });

  it("still names each in-window truth separately", () => {
    at();
    expect(absentTranscriptCopy(meeting({ capturePending: true }))).toContain("reload in a moment");
    expect(absentTranscriptCopy(meeting({ transcriptStatus: "plan_gated" }))).toContain("paid");
    expect(absentTranscriptCopy(meeting({ transcriptStatus: "not_ready" }))).toContain("finished");
    expect(absentTranscriptCopy(meeting({ transcriptStatus: "failed" }))).toContain(
      "couldn't be reached"
    );
  });
});
