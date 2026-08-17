import { describe, expect, test } from "vitest";
import { normalizeAreas, normalizeSlug } from "@/lib/ai/repo-areas-postprocess";

// The deterministic safety net over one area derivation. The prompt asks for all
// of this; these assert what happens when the model doesn't comply, which is the
// only case that matters — a bad vocabulary is permanent until someone refreshes,
// and every task classified in the meantime wears a label from it.

const ok = (slug: string, gloss = "a real area of this product") => ({
  slug,
  label: slug,
  gloss,
});

describe("normalizeSlug", () => {
  test("kebab-cases whatever the model returned", () => {
    expect(normalizeSlug("User Onboarding")).toBe("user-onboarding");
    expect(normalizeSlug("checkout_flow")).toBe("checkout-flow");
    expect(normalizeSlug("  Reporting  ")).toBe("reporting");
    expect(normalizeSlug("API/Integrations")).toBe("api-integrations");
  });

  test("truncates on a hyphen boundary rather than mid-word", () => {
    // 30 chars — over the 24 cap, with a hyphen at 17.
    expect(normalizeSlug("customer-support-ticketing")).toBe("customer-support");
  });

  test("truncates mid-word only when no hyphen is near the cut", () => {
    expect(normalizeSlug("supercalifragilisticexpialidocious")).toBe("supercalifragilisticexpi");
  });

  test("returns empty for a slug with nothing usable in it", () => {
    expect(normalizeSlug("///")).toBe("");
    expect(normalizeSlug("")).toBe("");
  });
});

describe("normalizeAreas", () => {
  test("keeps a clean vocabulary as-is", () => {
    const areas = normalizeAreas([ok("checkout"), ok("reporting"), ok("accounts")]);
    expect(areas.map((a) => a.slug)).toEqual(["checkout", "reporting", "accounts"]);
  });

  test("drops framework folders the prompt forbade", () => {
    // The model leaks these on layer-organized repos — a top level that really is
    // app/components/lib pulls hard toward returning them.
    const areas = normalizeAreas([
      ok("checkout"),
      ok("components"),
      ok("lib"),
      ok("src"),
      ok("reporting"),
      ok("utils"),
      ok("accounts"),
    ]);
    expect(areas.map((a) => a.slug)).toEqual(["checkout", "reporting", "accounts"]);
  });

  test("dedupes slugs that collide only after normalizing", () => {
    const areas = normalizeAreas([
      ok("Checkout"),
      ok("checkout"),
      ok("Check_Out"),
      ok("reporting"),
      ok("accounts"),
    ]);
    // Derivation order is preserved, so "Checkout" claims the slug and the
    // literal duplicate right after it is dropped.
    expect(areas.map((a) => a.slug)).toEqual(["checkout", "check-out", "reporting", "accounts"]);
    // Note the survivor: "Check_Out" normalizes to "check-out", which is a
    // DIFFERENT slug from "checkout" and is kept. Dedupe is exact-match on the
    // normalized slug, deliberately — collapsing near-spellings would need fuzzy
    // matching, and the same fuzziness would merge "user-accounts" with
    // "useraccounts" but also risk merging areas a repo means to keep apart.
    // Near-synonyms are the prompt's job (rule 5: make the areas mutually
    // exclusive), not the guard's.
  });

  test("drops an area with no gloss — the gloss IS the classifier's decision rule", () => {
    const areas = normalizeAreas([
      ok("checkout"),
      { slug: "reporting", label: "Reporting", gloss: "   " },
      ok("accounts"),
      ok("billing"),
    ]);
    expect(areas.map((a) => a.slug)).toEqual(["checkout", "accounts", "billing"]);
  });

  test("caps at 12 even when the model overshoots", () => {
    const many = Array.from({ length: 20 }, (_, i) => ok(`area-${i}`));
    expect(normalizeAreas(many)).toHaveLength(12);
  });

  test("collapses to empty when too few survive to be useful", () => {
    // Two labels can't separate a real backlog — callers read [] as "derivation
    // failed" and fall back to the generic taxonomy, which is the better outcome.
    expect(normalizeAreas([ok("checkout"), ok("lib"), ok("src")])).toEqual([]);
    expect(normalizeAreas([])).toEqual([]);
  });

  test("keeps a label's readable form while the slug stays kebab", () => {
    const [area] = normalizeAreas([
      { slug: "Auth & Billing", label: "Auth & Billing", gloss: "sign-in, plans, invoices" },
      ok("checkout"),
      ok("reporting"),
    ]);
    expect(area.slug).toBe("auth-billing");
    expect(area.label).toBe("Auth & Billing");
  });

  test("truncates an over-long gloss instead of dropping the area", () => {
    const [area] = normalizeAreas([
      { slug: "checkout", label: "Checkout", gloss: "x".repeat(400) },
      ok("reporting"),
      ok("accounts"),
    ]);
    expect(area.gloss).toHaveLength(120);
  });
});
