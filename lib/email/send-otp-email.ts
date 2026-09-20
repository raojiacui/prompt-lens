import { renderOtpEmail, resolveEmailLocale } from "@/lib/email/otp-email";
import { getEmailRuntimeConfig } from "@/lib/email/runtime-config";
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
  const emailConfig = getEmailRuntimeConfig();
  const message = renderOtpEmail({
    otp,
    locale,
    purpose,
    expiresInMinutes: 10,
    siteUrl: emailConfig.siteUrl,
    iconUrl: emailConfig.iconUrl,
  });
  await sendEmail({
    to: email,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}
