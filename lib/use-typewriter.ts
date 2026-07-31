import * as React from "react";

/**
 * Drives a typewriter loop over `phrases`: types one out, holds, deletes, then
 * advances to the next and repeats. Returns the current partial string plus the
 * viewer's reduced-motion preference so callers can render a stable fallback.
 *
 * `phrases` must be referentially stable across renders (a module constant or a
 * `useMemo`) — a fresh array each render restarts the loop. Pass `enabled:false`
 * to pause (e.g. while an input already holds text and the hint is hidden).
 */
export function useTypewriter(phrases: string[], enabled = true) {
  const [reduced, setReduced] = React.useState(false);
  const [index, setIndex] = React.useState(0);
  const [text, setText] = React.useState("");
  const [deleting, setDeleting] = React.useState(false);

  React.useEffect(() => {
    setReduced(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  }, []);

  React.useEffect(() => {
    if (reduced || !enabled || phrases.length === 0) return;
    const phrase = phrases[index % phrases.length];
    // Fully typed — hold, then start deleting.
    if (!deleting && text === phrase) {
      const hold = setTimeout(() => setDeleting(true), 2400);
      return () => clearTimeout(hold);
    }
    // Fully deleted — advance to the next phrase.
    if (deleting && text === "") {
      setDeleting(false);
      setIndex((i) => (i + 1) % phrases.length);
      return;
    }
    const tick = setTimeout(
      () => setText(phrase.slice(0, text.length + (deleting ? -1 : 1))),
      deleting ? 18 : 42
    );
    return () => clearTimeout(tick);
  }, [text, deleting, index, reduced, enabled, phrases]);

  return { text, reduced };
}
