import { describe, expect, it } from "vitest";
import { IMAGE_ANALYSIS_PRICES, imageAnalysisCostBudget, imageAnalysisPrice } from "@/lib/billing/image-analysis-pricing";
import { COMMERCIAL_PACKAGES } from "@/lib/billing/pricing-v6";
describe("image analysis tariff", () => {
  it.each(Object.keys(IMAGE_ANALYSIS_PRICES))("covers the documented budget and fee/margin reserves for %s across all packages", model => {
    const price = imageAnalysisPrice(model);
    const budget = imageAnalysisCostBudget(model);
    expect(price.credits).toBe(budget.requiredCredits);
    for (const pack of COMMERCIAL_PACKAGES) {
      const grossMicroCny = price.credits * pack.priceCents * 10000 / pack.credits;
      expect(grossMicroCny * 0.64).toBeGreaterThanOrEqual(budget.budgetMicroCny);
    }
  });
  it("budgets full Gemini rates after the temporary discount", () => {
    expect(imageAnalysisCostBudget("analysis-gemini-3-8-flash")).toEqual({ requiredCredits: 4, budgetMicroCny: 262244 });
    expect(imageAnalysisCostBudget("analysis-deepseek-v4-1-flash")).toEqual({ requiredCredits: 2, budgetMicroCny: 117737 });
  });
  it.each(["__proto__", "constructor", "analysis-gemini-2-5-pro", "", "gemini-3-8-flash-openai"])("refuses an unpriced model: %s", model => {
    expect(() => imageAnalysisPrice(model)).toThrow("IMAGE_MODEL_NOT_PRICED");
  });
});
