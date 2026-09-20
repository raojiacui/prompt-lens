import { renderOtpEmail, resolveEmailLocale } from "@/lib/email/otp-email";
import { sendEmail } from "@/lib/email/smtp";

type OtpPurpose = "sign-in" | "email-verification" | "forget-password" | "change-email";

type SendOtpEmailInput = {
  email: string;
  otp: string;
  purpose: OtpPurpose;
  headers?: Headers | null;
};

export async function sendOtpEmail({ email, otp, purpose, headers }: SendOtpEmailInput) {
  const locale = resolveEmailLocale(headers);
  const message = renderOtpEmail({
    otp,
    locale,
    purpose,
    expiresInMinutes: 10,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_BETTER_AUTH_URL,
  });
  await sendEmail({
    to: email,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}
