/**
 * Incremental scanner for a streaming JSON object of the shape
 * `{ "items": [ {...}, {...}, … ] }` — the strict structured-output envelope
 * used by the task extraction. Feed it text deltas as they arrive; it returns
 * each COMPLETED top-level element of the `items` array as soon as its closing
 * brace streams in, without waiting for the rest of the document.
 *
 * Pure string/brace/escape tracking — no dependency, no JSON.parse on partial
 * text. Anything that fails to parse as a complete element is skipped here and
 * left to the caller's final full-document validation.
 */
export function createItemsScanner(): (delta: string) => unknown[] {
  let buf = "";
  // Scan cursor: everything before `pos` has been consumed by the state machine.
  let pos = 0;
  let inArray = false;
  let finished = false;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let itemStart = -1;

  return function push(delta: string): unknown[] {
    if (finished) return [];
    buf += delta;
    const found: unknown[] = [];

    if (!inArray) {
      // The schema has exactly one top-level key, so the first `"items"` in the
      // document is the key itself and the next `[` opens the array.
      const key = buf.indexOf('"items"');
      if (key === -1) return found;
      const bracket = buf.indexOf("[", key);
      if (bracket === -1) return found;
      inArray = true;
      pos = bracket + 1;
    }

    for (; pos < buf.length; pos++) {
      const ch = buf[pos];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{" || ch === "[") {
        if (depth === 0 && ch === "{") itemStart = pos;
        depth++;
      } else if (ch === "}" || ch === "]") {
        if (depth === 0) {
          // The `]` closing the items array itself — nothing left to cut.
          finished = true;
          return found;
        }
        depth--;
        if (depth === 0 && ch === "}" && itemStart !== -1) {
          try {
            found.push(JSON.parse(buf.slice(itemStart, pos + 1)));
          } catch {
            // Malformed element — hold it for the final full-document parse.
          }
          itemStart = -1;
        }
      }
    }
    return found;
  };
}
