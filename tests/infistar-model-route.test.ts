import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ session: vi.fn(), credential: vi.fn(), catalog: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("@/lib/byok/credentials", () => ({ getUserCredential: mocks.credential }));
vi.mock("@/lib/ai/infistar-client", () => ({ listInfistarModels: mocks.catalog }));
import { GET } from "@/app/api/models/route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "owner" } });
  mocks.credential.mockResolvedValue({ provider: "infistar", apiKey: "catalog-fixture" });
  mocks.catalog.mockResolvedValue([]);
});
const request = () => new NextRequest("https://local.example/api/models?provider=infistar&category=video_generation");

it("keeps verified auto-group models visible even when the key catalog omits them", async () => {
  const response = await GET(request());
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.models.map((model: { providerModelId: string }) => model.providerModelId)).toContain("kling-v3");
  expect(mocks.credential).toHaveBeenCalledWith("owner", "infistar");
  expect(mocks.catalog).toHaveBeenCalledWith("catalog-fixture");
});

it("does not expose a configured catalog as a successful key check when credentials fail", async () => {
  mocks.catalog.mockRejectedValue(new Error("Invalid key"));
  expect((await GET(request())).status).toBe(502);
});

it("requires authentication before reading the saved key", async () => {
  mocks.session.mockResolvedValue(null);
  expect((await GET(request())).status).toBe(401);
  expect(mocks.credential).not.toHaveBeenCalled();
});
