import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth/auth-client";

export const metadata: Metadata = {
  title: "Prompt Analyzer - AI Video Prompt Generator",
  description: "Analyze videos and images to generate AI video prompts",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
