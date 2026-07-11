/**
 * Incremental scanner for the streaming PRD envelope
 * `{ "kind": "prd", "content": { "overview": …, "goals": …, "features": [ … ], … } }`.
 * Feed it the model's text deltas as they arrive; it returns each TOP-LEVEL key of
 * the `content` object the instant that key streams in — an honest, monotonic signal
 * of which PRD section the model is currently writing. It drives the wizard's real
 * progress display (replacing the old time-based estimate) without ever rendering
 * half-parsed prose, so there is no partial-JSON flicker.
 *
 * Sibling to `createItemsScanner` (stream-items.ts): pure brace/string/escape
 * tracking, no dependency and no JSON.parse on partial text. A question-round
 * envelope (`{ "kind": "questions", "items": [ … ] }`) has no `content` object, so
 * the scanner simply never arms and yields nothing.
 */
export function createPrdSectionScanner(): (delta: string) => string[] {
  let buf = "";
  // Scan cursor: everything before `pos` has been consumed by the state machine.
  let pos = 0;
  let armed = false; // seen `"content"` and its opening `{` — scanning keys now
  let finished = false;
  // Nesting depth INSIDE the content object: 0 == directly at the key level, >0 ==
  // inside a nested value (an array/object like features[] or constraintsDetail).
  let depth = 0;
  let inString = false;
  let escaped = false;
  let stringStart = -1;
  // At depth 0 the object alternates key → value → key …; `expectKey` is true when
  // the next string at depth 0 is a KEY (start of object, or just after a comma),
  // false when it is a VALUE (just after a colon). This is what separates a section
  // key from a string value that happens to sit at the top level.
  let expectKey = true;
  // Whether the currently-open string began at a key position (captured on the
  // opening quote, since depth/expectKey can change before it closes).
  let keyContext = false;

  return function push(delta: string): string[] {
    if (finished) return [];
    buf += delta;
    const found: string[] = [];

    if (!armed) {
      // The envelope's first `"content"` is the key; the next `{` opens the object
      // whose keys are the PRD sections.
      const key = buf.indexOf('"content"');
      if (key === -1) return found;
      const brace = buf.indexOf("{", key);
      if (brace === -1) return found;
      armed = true;
      pos = brace + 1;
    }

    for (; pos < buf.length; pos++) {
      const ch = buf[pos];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') {
          inString = false;
          // A string that opened at the key position (depth 0, expecting a key) is
          // a section key — emit it the moment it closes. Section keys are plain
          // identifiers with no escapes, so a raw slice is safe.
          if (keyContext) found.push(buf.slice(stringStart + 1, pos));
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        stringStart = pos;
        keyContext = depth === 0 && expectKey;
        continue;
      }
      if (ch === "{" || ch === "[") {
        depth++;
      } else if (ch === "}" || ch === "]") {
        if (depth === 0) {
          // The `}` closing the content object itself — nothing left to scan.
          finished = true;
          return found;
        }
        depth--;
      } else if (ch === ":") {
        if (depth === 0) expectKey = false;
      } else if (ch === ",") {
        if (depth === 0) expectKey = true;
      }
    }
    return found;
  };
}
