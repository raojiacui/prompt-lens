import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isAccessEmailAllowed, isAccessRestricted } from "@/lib/auth/access-policy";
import { LoginClient } from "./login-client";

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function normalizeNextPath(value: string | string[] | undefined) {
  const next = Array.isArray(value) ? value[0] : value;
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/dashboard";
  return next;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = searchParams ? await searchParams : {};
  const callbackUrl = normalizeNextPath(params.next);
  const suppressSessionRedirect = params.sessionRefreshFailed === "1";
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList }).catch(() => null);
  const restrictedAccess = isAccessRestricted();
  const sessionAccessAllowed = Boolean(session?.user && isAccessEmailAllowed(session.user.email));

  if (sessionAccessAllowed && !suppressSessionRedirect) {
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
