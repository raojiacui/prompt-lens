import { afterEach, describe, expect, it } from "vitest";
import { isAdminEmail, isAdminProfile, isAdminUserId } from "@/lib/auth";

const originalAdminEmails = process.env.ADMIN_EMAILS;
const originalAdminUserIds = process.env.ADMIN_USER_IDS;

afterEach(() => {
  process.env.ADMIN_EMAILS = originalAdminEmails;
  process.env.ADMIN_USER_IDS = originalAdminUserIds;
});

describe("admin identity helpers", () => {
  it("recognizes only the fixed owner email case-insensitively", () => {
    process.env.ADMIN_EMAILS = "Owner@Example.com, admin@example.com";

    expect(isAdminEmail(" RAOJIACUI@gmail.com ")).toBe(true);
    expect(isAdminEmail("owner@example.com")).toBe(false);
    expect(isAdminEmail("ADMIN@example.com")).toBe(false);
    expect(isAdminEmail("user@example.com")).toBe(false);
  });

  it("does not authorize configured user ids", () => {
    process.env.ADMIN_USER_IDS = "user-1,user-2";

    expect(isAdminUserId("user-1")).toBe(false);
    expect(isAdminUserId("user-3")).toBe(false);
  });

  it("requires the verified, unbanned owner account regardless of role", () => {
    process.env.ADMIN_EMAILS = "owner@example.com";
    process.env.ADMIN_USER_IDS = "user-2";

    const profile = { id: "user-2", email: "raojiacui@gmail.com", role: "user" as const, emailVerified: true, banned: false, isAnonymous: false };
    expect(isAdminProfile(profile)).toBe(true);
    expect(isAdminProfile({ ...profile, email: "person@example.com", role: "admin" })).toBe(false);
    expect(isAdminProfile({ ...profile, email: "owner@example.com" })).toBe(false);
    expect(isAdminProfile({ ...profile, emailVerified: false })).toBe(false);
    expect(isAdminProfile({ ...profile, banned: true })).toBe(false);
    expect(isAdminProfile({ ...profile, isAnonymous: true })).toBe(false);
  });
});
