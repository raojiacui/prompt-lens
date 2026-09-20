import { resolveEmailLocale } from "@/lib/email/otp-email";
import { sendEmail } from "@/lib/email/smtp";
import { renderWelcomeEmail } from "@/lib/email/welcome-email";

type SendWelcomeEmailInput = {
  email: string;
  name?: string | null;
  headers?: Headers | null;
};

export function welcomeEmailEnabled() {
  return process.env.WELCOME_EMAIL_ENABLED?.trim().toLowerCase() === "true";
}

export async function sendWelcomeEmail({ email, name, headers }: SendWelcomeEmailInput) {
  const message = renderWelcomeEmail({
    locale: resolveEmailLocale(headers),
    name,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_BETTER_AUTH_URL,
  });

  await sendEmail({
    to: email,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}
