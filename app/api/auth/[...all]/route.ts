import { auth } from "@/lib/auth";
import { getCanonicalOAuthStartRedirect } from "@/lib/auth/origin";
import { toNextJsHandler } from "better-auth/next-js";

export const runtime = 'nodejs';

const handler = toNextJsHandler(auth);

export const GET = handler.GET;
export const POST = withCanonicalOAuthOrigin(handler.POST);
export const PATCH = handler.PATCH;
export const PUT = handler.PUT;
export const DELETE = handler.DELETE;

function withCanonicalOAuthOrigin(
  authHandler: (request: Request) => Promise<Response>,
) {
  return async (request: Request) => {
    const canonicalRequestURL = getCanonicalOAuthStartRedirect(
      new URL(request.url),
      request.method,
    );

    if (!canonicalRequestURL) return authHandler(request);

    const canonicalLoginURL = new URL("/login", canonicalRequestURL.origin);
    console.warn("[Auth] Blocked OAuth sign-in from a non-canonical origin", {
      requestOrigin: new URL(request.url).origin,
      canonicalOrigin: canonicalRequestURL.origin,
    });

    return Response.json(
      {
        code: "OAUTH_CANONICAL_ORIGIN_REQUIRED",
        message: "OAuth sign-in must start from the production domain",
        canonicalURL: canonicalLoginURL.toString(),
      },
      {
        status: 409,
        headers: { "Cache-Control": "no-store" },
      },
    );
  };
}
