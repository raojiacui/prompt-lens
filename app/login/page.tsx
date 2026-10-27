import LoginClient from "./login-client";
import { getAuthBaseURL } from "@/lib/auth/origin";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const query = await searchParams;
  const error = typeof query.error === "string" ? query.error : undefined;
  return <LoginClient authBaseURL={getAuthBaseURL()} oauthError={error} />;
}
