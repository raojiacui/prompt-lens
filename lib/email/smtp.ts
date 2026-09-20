type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

function smtpConfig() {
  const names = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"] as const;
  const missing = names.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`[Email] Missing SMTP configuration: ${missing.join(", ")}`);
  }

  const port = Number.parseInt(process.env.SMTP_PORT || "465", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("[Email] SMTP_PORT must be a valid port number");
  }

  const secureSetting = process.env.SMTP_SECURE?.trim().toLowerCase();
  const secure = secureSetting ? secureSetting === "true" : port === 465;

  return {
    host: process.env.SMTP_HOST!,
    port,
    secure,
    user: process.env.SMTP_USER!,
    pass: process.env.SMTP_PASS!,
    from: process.env.SMTP_FROM!,
  };
}

export async function sendEmail(message: EmailMessage) {
  const config = smtpConfig();
  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });

  await transporter.sendMail({
    from: config.from,
    ...message,
  });
}
