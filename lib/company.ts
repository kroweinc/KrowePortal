/* Company display helpers for the profile Experience section. Logos resolve
   from the verified `company_domain` captured by the company autocomplete
   (CompanySuggestInput); entries without one show the company's initials. */

// Legal/entity suffixes that aren't part of the brand — dropped before
// building initials, so "Acme Corp" → "A".
const COMPANY_SUFFIXES = new Set([
  "inc", "incorporated", "llc", "ltd", "limited", "co", "corp", "corporation",
  "company", "gmbh", "plc", "lp", "llp", "group", "holdings",
]);

/** A company name split into brand words, with punctuation and legal suffixes
    removed. "Patel Gaines, LLC" → ["Patel", "Gaines"]. */
function brandWords(name: string): string[] {
  return name
    .trim()
    .replace(/[.,]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !COMPANY_SUFFIXES.has(w.toLowerCase()));
}

/** Up to two initials from a company name, e.g. "Patel Gaines" → "PG",
    "Google" → "G". Legal suffixes are ignored. Empty string for blank input. */
export function companyInitials(name: string): string {
  const words = brandWords(name);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0].charAt(0).toUpperCase();
  return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
}
