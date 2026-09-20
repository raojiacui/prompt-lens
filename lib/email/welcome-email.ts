import type { EmailLocale } from "@/lib/email/otp-email";

type WelcomeEmailInput = {
  locale: EmailLocale;
  name?: string | null;
  siteUrl?: string;
};

const translations = {
  zh: {
    subject: "欢迎来到 Prompt Lens，你的下一支视频从这里开始",
    preheader: "拆解灵感、复刻质感，再把它改写成属于你的新作品。",
    eyebrow: "WELCOME TO PROMPT LENS",
    greeting: (name?: string | null) => (name ? `${name}，欢迎来到 Prompt Lens` : "欢迎来到 Prompt Lens"),
    intro: "一条打动你的视频，不该只停留在收藏夹。Prompt Lens 帮你看懂每个镜头的构图、动作与光影，再把这些灵感变成真正属于你的新作品。",
    sectionTitle: "从看懂，到创造，只需要三步",
    steps: [
      ["01", "看懂每个镜头", "自动拆解视频节奏，提取构图、角色、运镜与风格提示词。"],
      ["02", "复刻完整质感", "带着可复刻 Prompt 进入生成，让相同的电影感重新发生。"],
      ["03", "改写成你的故事", "让 AI 修改角色、场景与叙事方向，从参考走向真正的原创。"],
    ],
    quote: "灵感不是终点。看懂它，然后创造下一幕。",
    button: "开始创造",
  },
  en: {
    subject: "Welcome to Prompt Lens. Your next video starts here",
    preheader: "Decode the inspiration, recreate the feeling, then make it unmistakably yours.",
    eyebrow: "WELCOME TO PROMPT LENS",
    greeting: (name?: string | null) => (name ? `Welcome to Prompt Lens, ${name}` : "Welcome to Prompt Lens"),
    intro: "A video that moves you should not stay buried in your bookmarks. Prompt Lens reveals the composition, motion, lighting and rhythm behind every shot, then helps you turn that inspiration into something new.",
    sectionTitle: "From inspiration to creation in three steps",
    steps: [
      ["01", "Understand every shot", "Break down pacing, composition, characters, camera movement and visual style."],
      ["02", "Recreate the feeling", "Take a reproducible prompt into generation and bring the cinematic language back to life."],
      ["03", "Make the story yours", "Rewrite characters, settings and direction with AI, moving from reference to original creation."],
    ],
    quote: "Inspiration is not the finish line. Understand it, then create the next frame.",
    button: "Start creating",
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

function safeFirstName(name?: string | null) {
  const candidate = name?.trim();
  if (!candidate || candidate.includes("@") || candidate.length > 40) return null;
  return candidate;
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

export function renderWelcomeEmail({ locale, name, siteUrl }: WelcomeEmailInput) {
  const content = translations[locale];
  const origin = normalizeSiteUrl(siteUrl);
  const dashboardUrl = `${origin}/dashboard?utm_source=welcome_email&utm_medium=email&utm_campaign=welcome`;
  const heroUrl = `${origin}/images/hero-text-fishing.jpg`;
  const iconUrl = `${origin}/prompt-lens-icon.png`;
  const greeting = content.greeting(safeFirstName(name));
  const steps = content.steps
    .map(
      ([number, title, description]) => `
        <tr>
          <td valign="top" style="padding:0 0 14px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f5f1e8;border:1px solid #e2dbce;border-radius:8px;">
              <tr>
                <td width="58" valign="top" style="width:58px;padding:18px 0 18px 18px;font-size:12px;line-height:18px;font-weight:700;color:#d97757;">${number}</td>
                <td valign="top" style="padding:16px 18px 16px 4px;">
                  <div style="font-size:16px;line-height:24px;font-weight:700;color:#1d1d1a;">${escapeHtml(title)}</div>
                  <div style="padding-top:4px;font-size:13px;line-height:21px;color:#69655d;">${escapeHtml(description)}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="${locale}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(content.subject)}</title>
    <style>@media only screen and (max-width:620px){.email-shell{width:100%!important}.email-pad{padding-left:24px!important;padding-right:24px!important}.hero-image{height:auto!important}}</style>
  </head>
  <body style="margin:0;padding:0;background:#ece8df;color:#1d1d1a;font-family:Arial,'Noto Sans SC','Microsoft YaHei',sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(content.preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#ece8df;">
      <tr>
        <td align="center" style="padding:32px 12px;">
          <table role="presentation" class="email-shell" width="620" cellspacing="0" cellpadding="0" border="0" style="width:620px;max-width:620px;background:#fffdfa;border:1px solid #d9d2c5;border-radius:8px;overflow:hidden;">
            <tr>
              <td background="${heroUrl}" width="620" height="349" valign="top" style="width:620px;height:349px;background-color:#d8d5cc;background-image:url('${heroUrl}');background-repeat:no-repeat;background-position:center;background-size:cover;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;">
                  <tr>
                    <td style="padding:22px 30px;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td width="40" valign="middle" style="width:40px;"><img src="${iconUrl}" width="40" height="42" alt="" style="display:block;width:40px;height:42px;object-fit:contain;border:0;"></td>
                          <td valign="middle" style="padding-left:10px;color:#1d1d1a;font-size:20px;line-height:26px;font-weight:700;">Prompt Lens</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="email-pad" style="padding:42px 46px 18px;">
                <div style="font-size:11px;line-height:16px;font-weight:700;color:#a35f42;">${content.eyebrow}</div>
                <h1 style="margin:10px 0 16px;font-size:30px;line-height:40px;font-weight:700;letter-spacing:0;color:#1d1d1a;">${escapeHtml(greeting)}</h1>
                <p style="margin:0;font-size:15px;line-height:25px;color:#5f5b54;">${escapeHtml(content.intro)}</p>
              </td>
            </tr>
            <tr>
              <td class="email-pad" style="padding:28px 46px 16px;">
                <h2 style="margin:0 0 18px;font-size:21px;line-height:30px;color:#1d1d1a;">${escapeHtml(content.sectionTitle)}</h2>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;">${steps}</table>
              </td>
            </tr>
            <tr>
              <td class="email-pad" style="padding:38px 46px 42px;text-align:center;background:#567d9d;">
                <p style="margin:0 0 26px;font-family:Georgia,'Times New Roman',serif;font-size:19px;line-height:29px;font-style:italic;color:#ffffff;">“${escapeHtml(content.quote)}”</p>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center">
                  <tr>
                    <td align="center" bgcolor="#ffffff" style="border-radius:999px;">
                      <a href="${dashboardUrl}" style="display:inline-block;padding:16px 34px;color:#1d1d1a;font-size:16px;line-height:22px;font-weight:700;text-decoration:none;border-radius:999px;">${escapeHtml(content.button)} &nbsp;✦</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
          <p style="margin:18px 0 0;font-size:11px;line-height:18px;color:#8f8a81;">&copy; ${new Date().getUTCFullYear()} Prompt Lens</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    greeting,
    "",
    content.intro,
    "",
    content.sectionTitle,
    ...content.steps.flatMap(([, title, description]) => [`- ${title}: ${description}`]),
    "",
    content.quote,
    "",
    `${content.button}: ${dashboardUrl}`,
  ].join("\n");

  return { subject: content.subject, html, text, dashboardUrl };
}
