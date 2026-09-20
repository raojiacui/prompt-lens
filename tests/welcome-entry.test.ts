import { describe, expect, it } from "vitest";
import { welcomeEntryDestination } from "@/lib/auth/welcome-entry";

describe("welcome email entry", () => {
  it("sends signed-in users to the four-feature dashboard", () => {
    expect(welcomeEntryDestination(true)).toBe("/dashboard");
  });

  it("sends signed-out users directly to login and returns them to the dashboard", () => {
    expect(welcomeEntryDestination(false)).toBe("/login?next=%2Fdashboard");
  });
});
