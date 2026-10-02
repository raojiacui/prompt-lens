import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const runtime = 'nodejs';

const handler = toNextJsHandler(auth);
function withoutAdminPlugin(next: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    // Administration uses the owner-only product endpoints, never role-based plugin endpoints.
    let pathname: string;
    try { pathname = decodeURIComponent(new URL(request.url).pathname).replace(/\/+/g, "/"); }
    catch { return Response.json({ error: "Invalid path" }, { status: 400 }); }
    if (pathname === "/api/auth/sign-in/anonymous" || pathname === "/api/auth/delete-anonymous-user" || pathname === "/api/auth/delete-user") {
      return Response.json({ error: "Verified account required" }, { status: 403 });
    }
    if (pathname === "/api/auth/admin" || pathname.startsWith("/api/auth/admin/")) {
      return Response.json({ error: "Admin access required" }, { status: 403 });
    }
    return next(request);
  };
}
export const GET = withoutAdminPlugin(handler.GET);
export const POST = withoutAdminPlugin(handler.POST);
export const PATCH = withoutAdminPlugin(handler.PATCH);
export const PUT = withoutAdminPlugin(handler.PUT);
export const DELETE = withoutAdminPlugin(handler.DELETE);
