import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isAccessEmailAllowed, isAccessRestricted } from "@/lib/auth/access-policy";
import { verifiedCachedSessionEmail } from "@/lib/auth/session-cache-access";
import { authReturnPath } from "@/lib/auth/return-path";
import { LoginClient } from "./login-client";

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = searchParams ? await searchParams : {};
  const callbackUrl = authReturnPath(Array.isArray(params.next) ? params.next[0] : params.next);
  const suppressSessionRedirect = params.sessionRefreshFailed === "1";
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList }).catch(() => null);
  const restrictedAccess = isAccessRestricted();
  const sessionAccessAllowed = Boolean(session?.user && isAccessEmailAllowed(session.user.email));

  if (sessionAccessAllowed && !suppressSessionRedirect) {
    const cachedEmail = restrictedAccess && process.env.BETTER_AUTH_SECRET
      ? await verifiedCachedSessionEmail(headersList, process.env.BETTER_AUTH_SECRET)
      : null;
    if (restrictedAccess && !isAccessEmailAllowed(cachedEmail)) {
      redirect(`/api/session-refresh?${new URLSearchParams({ next: callbackUrl })}`);
    }
    redirect(callbackUrl);
  }

  return (
    <LoginClient
      defaultCallbackUrl={callbackUrl}
      restrictedAccess={restrictedAccess}
      sessionAccessAllowed={sessionAccessAllowed}
      suppressSessionRedirect={suppressSessionRedirect}
    />
  );
}
