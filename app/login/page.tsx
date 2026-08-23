import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
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
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList }).catch(() => null);

  if (session?.user) {
    redirect(callbackUrl);
  }

  return <LoginClient defaultCallbackUrl={callbackUrl} />;
}