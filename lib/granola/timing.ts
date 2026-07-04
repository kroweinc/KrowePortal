import "server-only";

// Wall-clock stage breakdown for the Granola import hot paths, logged only when
// GRANOLA_TIMING=true — one structured line per action so before/after latency
// work can compare stage medians instead of guessing.

const ENABLED = process.env.GRANOLA_TIMING === "true";

export type StageTimer = {
  /** Record the time since the previous mark under `stage`. */
  mark(stage: string): void;
  /** Emit the single summary line, e.g. `[granola-draft] gates=180ms granola=1450ms ai=14200ms total=15900ms`. */
  done(extra?: string): void;
};

const NOOP: StageTimer = { mark() {}, done() {} };

export function stageTimer(label: string): StageTimer {
  if (!ENABLED) return NOOP;
  const start = Date.now();
  let last = start;
  const parts: string[] = [];
  return {
    mark(stage) {
      const now = Date.now();
      parts.push(`${stage}=${now - last}ms`);
      last = now;
    },
    done(extra) {
      parts.push(`total=${Date.now() - start}ms`);
      console.log(`[${label}] ${parts.join(" ")}${extra ? ` ${extra}` : ""}`);
    },
  };
}
