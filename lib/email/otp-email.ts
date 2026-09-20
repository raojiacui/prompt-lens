export type EmailLocale = "zh" | "en";

type OtpPurpose = "sign-in" | "email-verification" | "forget-password" | "change-email";

type OtpEmailInput = {
  otp: string;
  locale: EmailLocale;
  purpose: OtpPurpose;
  expiresInMinutes?: number;
  siteUrl?: string;
};

const copy = {
  zh: {
    subject: "Prompt Lens 登录验证码",
    preheader: "使用此验证码完成 Prompt Lens 登录",
    eyebrow: "安全验证",
    title: "欢迎回到 Prompt Lens",
    intro: "使用下面的验证码完成登录：",
    expiry: (minutes: number) => `验证码将在 ${minutes} 分钟后失效。`,
    security: "请勿将验证码告诉任何人。Prompt Lens 不会通过电话或消息向你索要验证码。",
    ignore: "如果不是你本人发起的操作，可以安全忽略这封邮件。",
    footer: "用灵感理解视频，用创作延续画面。",
  },
  en: {
    subject: "Your Prompt Lens sign-in code",
    preheader: "Use this verification code to sign in to Prompt Lens",
    eyebrow: "SECURE SIGN-IN",
    title: "Welcome back to Prompt Lens",
    intro: "Use the verification code below to finish signing in:",
    expiry: (minutes: number) => `This code expires in ${minutes} minutes.`,
    security: "Never share this code. Prompt Lens will never ask for it by phone or message.",
    ignore: "If you did not request this code, you can safely ignore this email.",
    footer: "Understand every frame. Create what comes next.",
  },
} as const;

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeSiteUrl(value?: string) {
  const fallback = "https://prompt-lens.cc.cd";
  try {
    const url = new URL(value || fallback);
    if (url.protocol !== "https:" && url.protocol !== "http:") return fallback;
    return url.origin;
  } catch {
    return fallback;
  }
}

function purposeCopy(locale: EmailLocale, purpose: OtpPurpose) {
  if (purpose === "sign-in") return copy[locale];

  const fallback = copy[locale];
  const subjects: Record<Exclude<OtpPurpose, "sign-in">, Record<EmailLocale, string>> = {
    "email-verification": {
      zh: "验证你的 Prompt Lens 邮箱",
      en: "Verify your Prompt Lens email",
    },
    "forget-password": {
      zh: "Prompt Lens 密码重置验证码",
      en: "Your Prompt Lens password reset code",
    },
    "change-email": {
      zh: "Prompt Lens 邮箱变更验证码",
      en: "Your Prompt Lens email change code",
    },
  };

  return { ...fallback, subject: subjects[purpose][locale] };
}

export function resolveEmailLocale(headers?: Headers | null): EmailLocale {
  const explicit = headers?.get("x-prompt-lens-locale")?.toLowerCase();
  if (explicit === "en" || explicit === "zh") return explicit;

  const cookie = headers?.get("cookie") ?? "";
  const cookieLocale = cookie
    .split(";")
    .map((entry) => entry.trim().split("="))
    .find(([name]) => name === "NEXT_LOCALE")?.[1]
    ?.toLowerCase();
  if (cookieLocale === "en" || cookieLocale === "zh") return cookieLocale;

  return headers?.get("accept-language")?.toLowerCase().startsWith("en") ? "en" : "zh";
}

export function renderOtpEmail({
  otp,
  locale,
  purpose,
  expiresInMinutes = 10,
  siteUrl,
}: OtpEmailInput) {
  const content = purposeCopy(locale, purpose);
  const safeOtp = escapeHtml(otp);
  const title = escapeHtml(content.title);
  const preheader = escapeHtml(content.preheader);
  const iconUrl = `${normalizeSiteUrl(siteUrl)}/prompt-lens-icon.png`;

  const html = `<!doctype html>
<html lang="${locale}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(content.subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f2efe7;color:#171714;font-family:Arial,'Noto Sans SC','Microsoft YaHei',sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f2efe7;">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;background:#fffdfa;border:1px solid #ddd7cb;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="padding:30px 38px 16px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td width="38" valign="middle" style="width:38px;"><img src="${iconUrl}" width="38" height="40" alt="" style="display:block;width:38px;height:40px;object-fit:contain;border:0;"></td>
                    <td valign="middle" style="padding-left:11px;font-size:20px;line-height:26px;font-weight:700;color:#171714;">Prompt Lens</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 38px 36px;">
                <div style="font-size:11px;line-height:16px;font-weight:700;color:#567d9d;text-transform:uppercase;">${escapeHtml(content.eyebrow)}</div>
                <h1 style="margin:10px 0 12px;font-size:27px;line-height:36px;font-weight:700;letter-spacing:0;color:#171714;">${title}</h1>
                <p style="margin:0 0 24px;font-size:15px;line-height:24px;color:#625f58;">${escapeHtml(content.intro)}</p>
                <div style="background:#eef3f6;border:1px solid #d4e0e7;border-radius:8px;padding:24px 12px;text-align:center;font-family:'Courier New',monospace;font-size:34px;line-height:42px;font-weight:700;letter-spacing:8px;color:#171714;">${safeOtp}</div>
                <p style="margin:18px 0 0;text-align:center;font-size:13px;line-height:20px;color:#7c776e;">${escapeHtml(content.expiry(expiresInMinutes))}</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin-top:28px;background:#f5f2eb;border-left:3px solid #1d1d1a;">
                  <tr>
                    <td style="padding:14px 16px;font-size:13px;line-height:21px;color:#625f58;">${escapeHtml(content.security)}</td>
                  </tr>
                </table>
                <p style="margin:24px 0 0;font-size:13px;line-height:21px;color:#8a867d;">${escapeHtml(content.ignore)}</p>
              </td>
            </tr>
          </table>
          <p style="margin:18px 0 0;font-size:11px;line-height:18px;color:#969188;">Prompt Lens · ${escapeHtml(content.footer)}<br>&copy; ${new Date().getUTCFullYear()} Prompt Lens</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    content.title,
    "",
    content.intro,
    otp,
    "",
    content.expiry(expiresInMinutes),
    content.security,
    "",
    content.ignore,
  ].join("\n");

  return { subject: content.subject, html, text };
}
