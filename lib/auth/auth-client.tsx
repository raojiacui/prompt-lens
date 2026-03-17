"use client";

import { createAuthClient } from "better-auth/react";
import { ReactNode } from "react";

export const authClient = createAuthClient({
  baseURL: typeof window !== "undefined" ? window.location.origin : undefined,
});

export const { useSession, signIn, signOut, signUp } = authClient;

// AuthProvider 组件
export function AuthProvider({ children }: { children: ReactNode }) {
  return children;
}
