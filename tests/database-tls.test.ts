import { createHash, X509Certificate } from "node:crypto";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { getDatabaseTlsOptions } from "@/lib/db/tls";

const pooler = "postgres://postgres.test:unused@aws-0-us-east-2.pooler.supabase.com:6543/postgres";

describe("database TLS", () => {
  it.each(["", "?sslmode=require", "?sslmode=disable", "?ssl=false"])(
    "enforces certificate verification despite URL mode %s",
    async (suffix) => {
      const url = pooler + suffix;
      const client = postgres(url, getDatabaseTlsOptions(url));
      try {
        expect(client.options.ssl).toMatchObject({ rejectUnauthorized: true });
        const ca = (client.options.ssl as { ca: string }).ca;
        const certificate = new X509Certificate(ca);
        expect(certificate.ca).toBe(true);
        expect(certificate.subject).toContain("Supabase Root 2021 CA");
        expect(createHash("sha256").update(ca).digest("hex"))
          .toBe("700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7");
      } finally {
        await client.end();
      }
    },
  );

  it("also protects direct Supabase connections", () => {
    expect(getDatabaseTlsOptions("postgres://user:unused@db.example.supabase.co/postgres").ssl)
      .toMatchObject({ rejectUnauthorized: true });
  });

  it.each([
    "postgres://localhost:5432/postgres",
    "postgres://127.0.0.1:5432/postgres",
    "postgres://db.example.com/postgres?sslmode=require",
    "postgres://supabase.com.example.com/postgres",
    "postgres://fake-supabase.com/postgres",
  ])("preserves other database configuration: %s", (url) => {
    expect(getDatabaseTlsOptions(url)).toEqual({});
  });
});
