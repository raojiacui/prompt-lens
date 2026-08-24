import { afterEach, describe, expect, it } from "vitest";
import { isAdminEmail, isAdminProfile, isAdminUserId } from "@/lib/auth";

const originalAdminEmails = process.env.ADMIN_EMAILS;
const originalAdminUserIds = process.env.ADMIN_USER_IDS;

afterEach(() => {
  process.env.ADMIN_EMAILS = originalAdminEmails;
  process.env.ADMIN_USER_IDS = originalAdminUserIds;
});

describe("admin identity helpers", () => {
  it("recognizes configured admin emails case-insensitively", () => {
    process.env.ADMIN_EMAILS = "Owner@Example.com, admin@example.com";

    expect(isAdminEmail("owner@example.com")).toBe(true);
    expect(isAdminEmail("ADMIN@example.com")).toBe(true);
    expect(isAdminEmail("user@example.com")).toBe(false);
  });

  it("recognizes configured admin user ids", () => {
    process.env.ADMIN_USER_IDS = "user-1,user-2";

    expect(isAdminUserId("user-1")).toBe(true);
    expect(isAdminUserId("user-3")).toBe(false);
  });

  it("treats role, email, or configured id as admin profile access", () => {
    process.env.ADMIN_EMAILS = "owner@example.com";
    process.env.ADMIN_USER_IDS = "user-2";

    expect(isAdminProfile({ id: "user-1", email: "person@example.com", role: "admin" })).toBe(true);
    expect(isAdminProfile({ id: "user-1", email: "owner@example.com", role: "user" })).toBe(true);
    expect(isAdminProfile({ id: "user-2", email: "person@example.com", role: "user" })).toBe(true);
    expect(isAdminProfile({ id: "user-3", email: "person@example.com", role: "user" })).toBe(false);
  });
});
