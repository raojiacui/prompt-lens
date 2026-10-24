import LoginClient from "./login-client";
import { getAuthBaseURL } from "@/lib/auth/origin";

export default function LoginPage() {
  return <LoginClient authBaseURL={getAuthBaseURL()} />;
}
