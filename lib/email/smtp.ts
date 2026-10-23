type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

const SMTP_VERIFY_TTL_MS = 5 * 60 * 1000;

let verifiedAt = 0;
let verificationPromise: Promise<void> | null = null;

function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;

  const first = value[0];
  const last = value[value.length - 1];
  if (value.length >= 2 && ((first === '"' && last === '"') || (first === "'" && last === "'"))) {
    return value.slice(1, -1).trim();
  }

  return value;
}

function smtpConfig() {
  const names = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"] as const;
  const values = Object.fromEntries(names.map((name) => [name, envValue(name)])) as Record<(typeof names)[number], string | undefined>;
  const missing = names.filter((name) => !values[name]);
  if (missing.length > 0) {
    throw new Error(`[Email] Missing SMTP configuration: ${missing.join(", ")}`);
  }

  const portValue = envValue("SMTP_PORT") || "465";
  if (!/^\d+$/.test(portValue)) {
    throw new Error("[Email] SMTP_PORT must be a valid port number");
  }
  const port = Number.parseInt(portValue, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("[Email] SMTP_PORT must be a valid port number");
  }

  const secureSetting = envValue("SMTP_SECURE")?.toLowerCase();
  const secure = secureSetting ? secureSetting === "true" : port === 465;

  return {
    host: values.SMTP_HOST!,
    port,
    secure,
    user: values.SMTP_USER!,
    pass: values.SMTP_PASS!,
    from: values.SMTP_FROM!,
  };
}

async function createTransport() {
  const config = smtpConfig();
  const nodemailer = await import("nodemailer");
  return {
    config,
    transporter: nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass,
      },
    }),
  };
}

export async function verifyEmailTransport() {
  if (Date.now() - verifiedAt < SMTP_VERIFY_TTL_MS) return;

  if (!verificationPromise) {
    verificationPromise = createTransport()
      .then(async ({ transporter }) => {
        await transporter.verify();
        verifiedAt = Date.now();
      })
      .finally(() => {
        verificationPromise = null;
      });
  }

  await verificationPromise;
}

export async function sendEmail(message: EmailMessage) {
  const { config, transporter } = await createTransport();

  await transporter.sendMail({
    from: config.from,
    ...message,
  });
}
