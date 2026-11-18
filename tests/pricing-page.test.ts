import { describe, expect, it } from "vitest";
import { creditRuleTopics } from "@/app/guide/credit-rules";
import { COMMERCIAL_PACKAGES } from "@/lib/billing/pricing-v6";

describe("public pricing content", () => {
  it("derives the package comparison and prices from the same source as checkout", () => {
    for (const zh of [true, false]) {
      const topics = creditRuleTopics(zh);
      const packageTable = topics[0].table;
      expect(packageTable?.rows).toHaveLength(COMMERCIAL_PACKAGES.length);
      for (const [index, pack] of COMMERCIAL_PACKAGES.entries()) {
        expect(packageTable?.rows[index].slice(1)).toEqual([
          (pack.priceCents / 100).toFixed(2),
          String(pack.credits),
          String(pack.rewrites),
          String(pack.linkImports),
        ]);
      }
      expect(topics.every(topic => Boolean(topic.title))).toBe(true);
      expect(topics.filter(topic => topic.table).length).toBeGreaterThanOrEqual(6);
    }
  });
});
