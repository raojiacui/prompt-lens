export type PolicyKind = "terms" | "privacy" | "refund";
export type PolicyDocument = {
  title: string;
  summary: string;
  sections: { id: string; title: string; paragraphs: string[] }[];
};

export const POLICY_UPDATED_AT = "2026-11-17";
export const POLICY_LINKS = [
  { kind: "terms", href: "/terms", zh: "服务条款", en: "Terms of Service" },
  { kind: "privacy", href: "/privacy", zh: "隐私政策", en: "Privacy Policy" },
  { kind: "refund", href: "/refund", zh: "退款与取消政策", en: "Refund & Cancellation Policy" },
] as const;

export const policyContent: Record<"zh" | "en", Record<PolicyKind, PolicyDocument>> = {
  zh: {
    terms: {
      title: "服务条款",
      summary: "使用 Prompt Lens 前，请了解服务范围、费用、内容责任以及遇到问题时的处理方式。",
      sections: [
        { id: "operator", title: "1. 服务提供者与适用范围", paragraphs: [
          "Prompt Lens 由个人开发者运营，为用户提供视频拆镜分析、提示词提取与改写，以及支持模型的视频生成工具。产品不代表底层模型供应商，也不承诺特定模型的生成质量。运营与售后联系方式见本页下方。",
          "使用本服务前，请阅读本条款及隐私政策。购买时适用的商品说明、确认报价和退款与取消政策一并说明你的权益。影响已购权益的重大变更会通过站内提示或账户邮箱告知；法律赋予你的权利不受本条款限制。",
        ] },
        { id: "account", title: "2. 账户与服务使用", paragraphs: [
          "本服务面向年满18周岁、能够独立承担相应责任的用户。请提供准确的账户信息，保护邮箱、第三方登录账户和 API Key，并仅使用本人有权使用的账户和密钥。发现账户被盗用时，请及时联系客服。",
          "请勿绕过登录、试用次数、计费或访问限制，冒用他人身份，恶意批量注册，干扰系统或尝试访问他人的项目、密钥及订单。我们可对有证据的滥用采取限制访问等措施；如有异议，可通过下方邮箱联系核查。",
        ] },
        { id: "billing", title: "3. 套餐、积分与交付", paragraphs: [
          "套餐为一次性购买，无自动续费。可购买状态、币种、金额、包含积分及次数，以购买页面和订单确认为准；标为“待开放”的套餐暂不接受新购。付款由结算页实际显示的支付服务商处理，付款成功经后台核对后，权益发放至对应的站内账户。",
          "平台积分及套餐次数用于本站标明的服务，不能作为通用货币转让或提现。付费任务在确认前展示费用，按实际成功交付结果结算；处理中可能暂占额度，失败或核查后的未交付部分按现有计费规则释放。部分成功任务可按已交付部分结算。",
          "使用自带 API Key 时，底层模型费用由你与对应供应商结算；自动拆镜等单独收费项目仍以站内报价为准。本站退款不包括你直接向供应商支付的费用。报价、记录或到账有疑问时，请提供订单号或任务号联系核查。",
        ] },
        { id: "content", title: "4. 素材权利与允许的使用", paragraphs: [
          "上传、导入或处理的素材应由你拥有，或已取得必要授权，包括其中人物的肖像、声音及其他个人信息。公开分享链接不代表你已获得复制、下载、改编或商业使用授权。不得利用服务绕过来源平台的访问限制。",
          "你保留对输入素材依法享有的权利，并授权我们及完成任务所必要的服务商处理这些素材。生成结果的可使用范围还受底层模型条款、第三方权利及适用法律约束；我们不保证结果具有独占性或一定可获得著作权。",
        ] },
        { id: "safety", title: "5. 禁止内容与违规处理", paragraphs: [
          "禁止利用服务制作或传播儿童性剥削内容、色情及非自愿私密影像、违法暴力或伤害内容、仇恨与歧视内容、诈骗冒充、未经授权的真人换脸或深度伪造，以及侵犯著作权、商标、肖像或隐私权的内容。不得将生成内容伪装为真实人物的真实言论或事件以误导他人。",
          "AI 输出可能不准确或不适合你的用途。公开使用前请自行复核，并按适用要求标明 AI 生成。我们可依据供应商返回的安全结果、投诉和人工核查拒绝任务、限制违规账户或移除侵权内容；这些措施不表示系统能够拦截所有违规内容。举报或申诉请提供内容链接、任务号、问题说明和必要的权利证明。",
        ] },
        { id: "availability", title: "6. 服务可用性与素材保存", paragraphs: [
          "处理时间受素材、网络及模型供应商影响，预估时间不构成完成时限保证。AI 输出不保证完全准确、可复现或满足主观审美预期。遇到失败、重复扣费或未交付，请通过退款与取消政策所列方式核查。",
          "本站不是永久素材存储服务。项目素材和分析内容按现有七天保留规则清理；线上生成历史通常从创建起保留七天，处理中任务暂缓清理。供应商托管的视频链接有各自有效期。请及时下载结果，详细规则见使用教程和隐私政策。",
        ] },
        { id: "support", title: "7. 取消、退款与联系", paragraphs: [
          "一次性套餐没有需要关闭的自动续费。退款、未使用权益、处理中任务及争议的处理方式见退款与取消政策。停止使用不等于已提交退款，删除 API Key 也不会取消已提交至供应商的任务。",
          "对收费、交付、隐私或内容处理有异议时，请联系本页下方邮箱协商处理。法律规定的退款、消费者保护和争议救济权利继续适用。",
        ] },
      ],
    },
    privacy: {
      title: "隐私政策",
      summary: "说明 Prompt Lens 在登录、素材处理、模型调用、订单及客服处理中收集和使用哪些信息。",
      sections: [
        { id: "collection", title: "1. 我们处理的信息", paragraphs: [
          "账户信息：邮箱、显示名称、头像、第三方登录关联标识、邮箱验证和会话信息。使用 Google 或 GitHub 登录时，会收到你授权提供的账户资料；邮箱验证码用于验证登录。",
          "创作数据：你上传或导入的视频、图片、分享链接、提示词、改写指令，以及任务参数、分析结果、关键帧、生成结果链接和任务状态。你保存自带 API Key 时，我们保存加密后的密钥及其供应商、名称等设置。",
          "交易与支持信息：订单、支付服务商订单标识、金额、权益发放、使用及预留、退款记录，以及你提交的联系方式、工单和问题说明。支付密码、完整银行卡信息等由付款页面的支付服务商处理，请勿在工单中提供。",
          "访问与诊断信息：访问路径、访问时间、IP地址、浏览器信息、会话标识及相关错误日志，用于访问统计、安全防护和故障排查。网站还集成 Vercel Analytics 进行访问统计，并从 Google Fonts 加载字体资源。",
        ] },
        { id: "purposes", title: "2. 使用目的", paragraphs: [
          "我们使用上述信息提供登录、保存和读取项目、执行你确认的模型任务、核对支付和退款、发放与结算权益、处理客服请求，以及维护安全和服务稳定性。必需信息未提供时，对应功能可能无法使用。",
          "使用任务所需素材会被发送给你所选模型对应的服务商。请勿上传与任务无关的身份证、财务资料、商业秘密或其他敏感内容；上传他人的个人信息前，应取得适当授权。",
        ] },
        { id: "providers", title: "3. 服务商与数据传输", paragraphs: [
          "网站运行涉及 Vercel（托管、日志及访问统计）、Supabase（数据库）、Cloudflare R2（素材存储）及后台任务运行服务。登录和邮件发送还涉及 Google、GitHub 及配置的邮件服务。",
          "根据你选择的功能和模型，相关提示词、素材或可访问素材的链接会提供给 KIE、Infistar 等模型服务商及其底层模型提供方；导入分享链接时，该链接也会交由链接解析服务处理。支付时，必要订单信息提供给结算页显示的支付服务商。",
          "视频生成模型与积分规则：本站《使用教程》的积分规则页面公开列出具体模型和不同配置的价格，包括 Google Veo 3.1（Lite / Fast / Quality）、字节跳动 Seedance 2 / Fast / Mini、可灵 Kling 2.6 / Kling 3、通义万相 Wan 2.6 / Wan 2.7，以及 Wan 2.7 Video Edit。教程按模型、画质、声音、时长和参考视频等配置列出积分；例如教程目前示例中的 Wan 720p、5 秒生成一条视频为 29 平台积分。各模型并非每种配置均可用；实际收费以视频生成页面在提交任务前显示的实时确认报价为准。详见 https://prompt-lens.cc.cd/guide 。生成任务的提示词、图片及视频等必要内容可能经 KIE、Infistar 等模型接入服务传输至你所选的底层模型提供方。",
          "为降低违规 AI 生成风险，在启用提示词安全审核时，生成前的文字提示词可能发送给 Waffo Pancake 内容安全扫描接口进行合规检查。在 V2 测试环境，生成的视频还可能通过可访问的视频链接提交给独立内容审核服务 Sightengine，在审核结论明确允许之前不展示生成结果。该处理涉及额外第三方服务商，且不能保证识别所有版权或真人伪造风险。部分服务商在中国大陆以外运行，数据可能在境外传输、处理或存储。服务商还受各自的隐私与数据处理条款约束。请在提交前考虑素材敏感程度；如需确认某个模型或任务的数据流向，可联系下方邮箱。",
        ] },
        { id: "cookies", title: "4. Cookie 与本地存储", paragraphs: [
          "网站使用 Cookie 维持登录状态、保存语言偏好，以及用访问标识辅助统计。登录会话通常有效30天，语言偏好和访问标识 Cookie 可保留一年，具体期限会随刷新、退出登录或浏览器清理而变化。",
          "浏览器本地存储还可能保存界面偏好、工作区恢复信息和避免重复创建订单的请求标识。你可以在浏览器中清除 Cookie 或本地存储；清除后可能需要重新登录或重新选择设置，不会自动删除服务器上的项目或订单。",
        ] },
        { id: "retention", title: "5. 数据保存与清理", paragraphs: [
          "项目原视频、镜头片段、关键帧和分析提示词在项目最近一次相关内容生成或分析后按七天规则进入清理；仅修改标题或轮询进度不会延长保存期。线上生成历史从创建起按七天规则清理，处理中及待核查任务暂缓。定时任务分批执行，实际完成清理可能晚于到期时间。",
          "生成视频可能托管在供应商处，其下载链接及供应商保留期限由该供应商决定。请及时下载。素材到期清理不会自动删除账户、订单、积分、退款和必要审计记录；这些记录按服务、安全、账务及适用法律所需期限保存。备份及服务商副本可能有不同的删除周期。",
        ] },
        { id: "security", title: "6. 信息安全与处理边界", paragraphs: [
          "我们采用 HTTPS、账户访问校验及 API Key 加密存储等措施。执行你选择的模型请求时，服务器需要解密对应 Key 并提交至该供应商。请自行控制 Key 的权限、额度及撤销；任何系统均无法保证绝对安全。",
          "账户权限和素材保留不等于公开发布授权。客服或运维在排查问题、处理争议及安全事件时，可能需要核查必要的任务信息；请在联系时尽量提供任务号和脱敏截图。我们也可能依法向有权机关提供必要记录。",
        ] },
        { id: "rights", title: "7. 查询、更正、删除与联系", paragraphs: [
          "你可以在账户及设置页面管理可编辑的个人资料和自带 API Key。需要查询、导出、更正或删除个人数据、关闭账户，或对处理方式提出异议时，请通过下方邮箱提出请求。我们会核验账户归属，并说明可处理范围；当前没有自助账户注销按钮。",
          "为防止冒用，我们可能要求补充必要的归属证明。涉及未完成任务、退款、纠纷或依法需保留的交易与审计记录时，部分删除可能延后或受到限制，并向你说明原因。请勿通过普通邮件发送完整密钥或支付密码。",
        ] },
      ],
    },
    refund: {
      title: "退款与取消政策",
      summary: "说明一次性套餐、任务失败、未使用权益和退款申请如何处理。你无需登录即可阅读本政策。",
      sections: [
        { id: "purchase", title: "1. 一次性购买与取消", paragraphs: [
          "Prompt Lens 套餐为一次性购买，无自动续费，因此没有需要取消的周期扣款。金额、币种、积分与次数以购买页面及订单为准；标记为“待开放”的套餐暂不支持新购。",
          "未付款订单通常在创建后15分钟到期并进入核对、关闭流程。已付款订单会先核对付款事实及权益交付，不会因页面超时直接视为未付款。请勿在付款结果不明确时反复下单；可先查看订单或联系客服。",
        ] },
        { id: "unused", title: "2. 未使用套餐的退款申请", paragraphs: [
          "已付款且套餐积分、改写次数和链接导入权益均未使用、没有预留或处理中任务的订单，可以提交整单退款申请，由客服核实后决定办理。当前站内标准退款流程处理整单，不支持用户自行输入部分退款金额。",
          "提交申请后，对应套餐权益会暂停使用，避免审核期间继续消耗。客服同意且支付渠道确认退款成功后，撤销对应权益并更新订单；申请未通过会恢复可用权益。提交申请不等于退款已经完成。",
        ] },
        { id: "used", title: "3. 已使用、处理中或交付异常", paragraphs: [
          "已有积分、改写或链接导入消耗，或存在处理中任务、预留额度的订单，需要联系客服逐项核查；当前自助工单入口可能提示暂不符合整单退款条件。我们会结合已交付内容、实际消耗、故障证据和适用法律处理，不承诺所有已使用订单均可全额退还。",
          "重复扣费、付款后权益未到账、持续无法使用或其他实质性交付问题，请提供订单号和说明。AI 结果可能存在差异，主观不满意不会自动触发退款；如果存在实际服务缺陷或依法可退款情形，可提交证据核查。本政策不排除法律要求的退款及其他消费者权利。",
        ] },
        { id: "tasks", title: "4. 任务失败与积分释放", paragraphs: [
          "平台积分任务失败或中断后，会核实是否产生有效交付，并按任务结算规则释放未交付部分的预留额度。供应商结果暂不明确时可能进入待核查状态，不会仅凭浏览器超时判定完成或再次扣费。部分镜头已成功交付的分析任务可能只结算成功部分。",
          "积分释放与原支付订单的资金退款属于不同处理：释放额度后，积分可继续使用；如需退回购买款项，仍按本政策申请。自带 API Key 的供应商费用由对应供应商处理，本站无法替其承诺退款。已提交到供应商的任务不保证能够即时撤销。",
        ] },
        { id: "request", title: "5. 如何申请与跟进", paragraphs: [
          "登录购买时使用的账户，进入“订单与退款申请”，选择已付款订单，提交原因及联系邮箱或微信号；随后通过下方客服邮箱或微信沟通。无法登录或工单无法提交时，可以直接邮件联系我们。",
          "请提供站内订单号、付款日期及金额、相关任务号和问题描述；付款截图应隐藏与问题无关的个人资料。请勿发送银行卡密码、支付密码、验证码或 API Key。我们可能要求必要的账户归属核验。",
          "申请由人工处理；处理进度受资料完整度、任务及支付渠道核查影响。我们会通过工单或你提供的联系方式反馈结果，审核与渠道入账时间分别计算，无法承诺即时到账。结果不明的退款会继续核查，避免重复发起。",
        ] },
        { id: "destination", title: "6. 退款渠道与政策适用", paragraphs: [
          "获批准的退款通过原订单的支付渠道办理；最终到账时间和可退款范围以支付渠道实际处理及适用规则为准。若交易由结算页标明的名义销售方代售，其订单、退款及争议条款也可能适用，请同时查看付款收据上的联系方式。",
          "本页不表示任何待审核支付渠道已经开通。对处理结果有异议时，可提供订单号继续沟通，也可使用适用法律和支付渠道提供的争议解决途径。",
        ] },
      ],
    },
  },
  en: {
    terms: {
      title: "Terms of Service",
      summary: "Understand the service, charges, content responsibilities and support process before using Prompt Lens.",
      sections: [
        { id: "operator", title: "1. Provider and scope", paragraphs: [
          "Prompt Lens is operated by an individual developer. It provides video shot analysis, prompt extraction and rewriting, and video generation with supported models. It does not represent the underlying model providers or guarantee a particular model's output quality. Operator and support contact details are below.",
          "Read these Terms and the Privacy Policy before using the service. Product descriptions, confirmed quotes and the Refund & Cancellation Policy explain purchased benefits. Material changes affecting purchased benefits will be communicated through the site or your account email. These Terms do not limit rights granted by applicable law.",
        ] },
        { id: "account", title: "2. Accounts and access", paragraphs: [
          "The service is intended for users aged 18 or older who can take responsibility for their use. Provide accurate account information and protect your email, third-party login accounts and API keys. Use only accounts and keys you are authorized to use. Contact support promptly if your account is compromised.",
          "Do not bypass authentication, trials, billing or access limits, impersonate others, create abusive accounts, disrupt the service, or access another user's projects, keys or orders. We may restrict access when there is evidence of abuse. Contact the email below to dispute an action.",
        ] },
        { id: "billing", title: "3. Packages, credits and delivery", paragraphs: [
          "Packages are one-time purchases with no automatic renewal. Availability, currency, price, credits and allowances are shown at purchase and in the order confirmation. Packages marked Coming soon are not open for new purchases. Payments are handled by the provider displayed at checkout; benefits are credited to the corresponding site account after the backend verifies successful payment.",
          "Credits and package allowances apply to the identified services on this site and cannot be transferred as general money or cashed out. Paid tasks show a quote before confirmation and settle against successful delivery. Allowances may be reserved during processing; unused portions are released after failure or reconciliation. A partially successful task may be charged for the delivered portion.",
          "When you use your own API key, the selected provider bills you directly for model usage. Separately charged features such as automatic shot splitting still follow the site quote. Site refunds do not include fees paid directly to those providers. Send the order or task ID to support if a quote, charge or delivery is unclear.",
        ] },
        { id: "content", title: "4. Rights to materials and outputs", paragraphs: [
          "You must own or have the necessary permissions for uploaded, imported and processed materials, including likeness, voice and personal information. A public share link does not grant permission to copy, download, adapt or commercially use its content. Do not bypass the source platform's access restrictions.",
          "You retain your lawful rights in inputs and authorize us and the service providers necessary to complete your task to process those materials. Rights to use outputs also depend on the underlying model terms, third-party rights and applicable law. We do not guarantee exclusivity or copyright eligibility of outputs.",
        ] },
        { id: "safety", title: "5. Prohibited content and enforcement", paragraphs: [
          "Do not create or distribute child sexual exploitation material, pornography or non-consensual intimate imagery, unlawful violence or harm, hate or discrimination, fraud or impersonation, unauthorized real-person face swaps or deepfakes, or content infringing copyright, trademarks, likeness or privacy. Do not present generated content as real statements or events involving a real person in order to mislead others.",
          "AI outputs may be inaccurate or unsuitable. Review them before publication and label AI-generated material where required. We may reject tasks, restrict abusive accounts or remove infringing content based on provider safety responses, reports and human investigation. This does not mean all harmful content is automatically detected. To report an issue or appeal, send the content link, task ID, explanation and any necessary rights evidence.",
        ] },
        { id: "availability", title: "6. Availability and retention", paragraphs: [
          "Processing depends on the media, network and model provider. Estimates are not completion guarantees. Outputs are not guaranteed to be accurate, reproducible or aesthetically satisfactory. Report failures, duplicate charges or non-delivery using the Refund & Cancellation Policy.",
          "This is not a permanent media archive. Project media and analysis follow the existing seven-day retention rules. Production generation history is normally retained for seven days from creation; active tasks postpone cleanup. Provider-hosted video links have their own expiry periods. Download results promptly; see the guide and Privacy Policy for details.",
        ] },
        { id: "support", title: "7. Cancellation, refunds and contact", paragraphs: [
          "One-time packages have no recurring renewal to cancel. The Refund & Cancellation Policy explains unused benefits, processing tasks and disputes. Stopping use does not submit a refund request, and removing an API key does not cancel a task already submitted to its provider.",
          "Contact the email below about charges, delivery, privacy or content decisions. Mandatory refund, consumer-protection and dispute-resolution rights continue to apply.",
        ] },
      ],
    },
    privacy: {
      title: "Privacy Policy",
      summary: "How Prompt Lens handles information for sign-in, media processing, model requests, orders and customer support.",
      sections: [
        { id: "collection", title: "1. Information we process", paragraphs: [
          "Account information includes email, display name, avatar, third-party login identifiers, verification and session information. Google or GitHub sign-in supplies account details you authorize. Email verification codes authenticate sign-in.",
          "Creative data includes uploaded or imported videos, images, share links, prompts, rewrite instructions, task settings, analysis results, keyframes, generated-result links and task states. If you save your own API key, we store an encrypted key and related provider and display settings.",
          "Transaction and support data includes orders, payment-provider order references, amounts, benefit grants, usage, reservations, refund records and the contact information and issue descriptions you submit. Payment passwords and full card details are handled by the payment provider's checkout; do not send them in support tickets.",
          "Visit and diagnostic data includes page paths, timestamps, IP addresses, browser information, session identifiers and error logs for analytics, security and troubleshooting. The site also integrates Vercel Analytics for traffic measurement and loads font resources from Google Fonts.",
        ] },
        { id: "purposes", title: "2. Purposes", paragraphs: [
          "We use this information to authenticate access, save and retrieve projects, execute confirmed tasks, verify payments and refunds, grant and settle benefits, handle support and maintain security and reliability. A feature may be unavailable if its necessary information is not provided.",
          "Materials necessary for a task are sent to the services associated with the model you select. Do not upload unrelated identity documents, financial information, trade secrets or other sensitive content. Obtain appropriate authorization before uploading another person's information.",
        ] },
        { id: "providers", title: "3. Service providers and transfers", paragraphs: [
          "Operations involve Vercel for hosting, logs and analytics, Supabase for the database, Cloudflare R2 for media storage, and background task hosting. Authentication and email delivery also involve Google, GitHub and the configured email services.",
          "Depending on the feature and model selected, relevant prompts, media or accessible media links are sent to model services such as KIE and Infistar and their underlying model providers. Imported share links are also processed by a link-resolution service. Necessary order information is sent to the payment provider shown at checkout.",
          "Video generation models and credit pricing: Our public Guide lists model-specific credits for configurations including Google Veo 3.1 (Lite / Fast / Quality), ByteDance Seedance 2 / Fast / Mini, Kling 2.6 / Kling 3, Wan 2.6 / Wan 2.7, and Wan 2.7 Video Edit. The guide details credits by model, quality, audio, duration, and video reference options; for example, its current Wan 720p five-second example costs 29 platform credits per output. Not all model/configuration combinations are available. The final price is the quote presented before a user confirms generation. See https://prompt-lens.cc.cd/guide . Required prompts, images, and videos may be transferred via aggregation providers such as KIE or Infistar to the underlying model provider selected by the user.",
          "When prompt safety review is enabled, user-written text may be sent to Waffo Pancake before video generation. In the V2 test environment, generated videos may also be submitted through an accessible video URL to the independent safety provider Sightengine; the generated video is withheld until its output review explicitly permits display. This adds a third-party recipient and is not a guarantee of copyright or deepfake detection. Some providers operate outside mainland China, and media may be transmitted, processed or stored abroad. Their own privacy and processing terms also apply. Consider the sensitivity of your media before submitting. Contact support to clarify a task's data flow.",
        ] },
        { id: "cookies", title: "4. Cookies and local storage", paragraphs: [
          "Cookies maintain sign-in, remember language preferences and identify visits for statistics. Sign-in sessions generally last 30 days. Language and visit-identifier cookies can last a year; refresh, sign-out and browser clearing can change these periods.",
          "Browser local storage may retain interface preferences, workspace recovery information and request identifiers that prevent duplicate orders. You can clear cookies and local storage in your browser; this may require signing in again or resetting preferences and does not automatically delete server-side projects or orders.",
        ] },
        { id: "retention", title: "5. Retention and cleanup", paragraphs: [
          "Source videos, shot clips, keyframes and analysis prompts become eligible for cleanup under the seven-day rule after the latest relevant project content or analysis. Renaming a project or polling progress does not extend retention. Production generation history follows a seven-day rule from creation; active tasks and tasks under reconciliation postpone cleanup. Scheduled cleanup is batched and may finish after eligibility begins.",
          "Generated videos may be hosted by providers with their own link and retention periods. Download promptly. Media cleanup does not automatically delete accounts, orders, credits, refunds or necessary audit records. These are retained for service, security, accounting and applicable legal needs. Backups and provider copies may have different deletion cycles.",
        ] },
        { id: "security", title: "6. Security and access", paragraphs: [
          "We use HTTPS, account access checks and API-key encryption at rest. The server decrypts a saved key to send your selected requests to its provider. Control your keys' permissions and spending limits and revoke them when appropriate. No system guarantees absolute security.",
          "Access permissions and media retention do not authorize public publication. Support or operations may inspect necessary task information to investigate issues, disputes and security incidents. Prefer task IDs and redacted screenshots when contacting support. Necessary records may also be provided to authorized authorities as required by law.",
        ] },
        { id: "rights", title: "7. Access, correction, deletion and contact", paragraphs: [
          "Manage editable profile details and API keys in account settings. Contact the email below to request access, export, correction or deletion of personal data, account closure, or to object to processing. We verify account ownership and explain what can be handled. There is currently no self-service account deletion button.",
          "We may request necessary ownership evidence to prevent impersonation. Open tasks, refunds, disputes or legally required transaction and audit records may delay or limit deletion; we will explain the reason. Do not send full API keys or payment passwords in ordinary email.",
        ] },
      ],
    },
    refund: {
      title: "Refund & Cancellation Policy",
      summary: "How one-time packages, failed tasks, unused benefits and refund requests are handled. No sign-in is needed to read this policy.",
      sections: [
        { id: "purchase", title: "1. One-time purchases and cancellation", paragraphs: [
          "Prompt Lens packages are one-time purchases with no automatic renewal or recurring charge to cancel. Price, currency, credits and allowances are shown on the purchase page and order. Packages marked Coming soon are not open for new purchases.",
          "Unpaid orders normally expire 15 minutes after creation and enter reconciliation and closure. Paid orders are checked for actual payment and benefit delivery, even if the page times out. Do not repeatedly order while payment is uncertain; check the order or contact support first.",
        ] },
        { id: "unused", title: "2. Refund requests for unused packages", paragraphs: [
          "For a paid order with no used credits, rewrites or link imports, and no reservations or processing tasks, you may request a full-order refund for customer-service review. The current standard site process handles full orders and does not allow a user-entered partial refund amount.",
          "The package's benefits are suspended during review to prevent further use. If support approves and the payment channel confirms the refund, the benefits are revoked and the order updated. A declined request restores available benefits. Submitting a request does not mean the refund has completed.",
        ] },
        { id: "used", title: "3. Used benefits, active tasks and delivery issues", paragraphs: [
          "Orders with consumed credits, rewrites or imports, active tasks or reservations need individual support review. The ticket form may report that a full-order request is not currently eligible. We consider delivered services, actual usage, fault evidence and applicable law; a full refund is not guaranteed for every used order.",
          "Report duplicate charges, payment without credited benefits, persistent inability to use the service or other material delivery issues with the order ID and details. AI output varies, and subjective dissatisfaction does not automatically trigger a refund. Actual service defects and legally required refunds can be reviewed. This policy does not remove mandatory consumer rights.",
        ] },
        { id: "tasks", title: "4. Failed tasks and released credits", paragraphs: [
          "When a platform-credit task fails or is interrupted, delivery is verified and undelivered reservations are released according to settlement rules. An uncertain provider result may enter reconciliation. A browser timeout alone is not proof of completion or a reason to charge again. Shot analysis with successful scenes may settle only the delivered portion.",
          "Releasing credits and refunding a purchase are separate processes. Released credits remain usable; returning the original purchase price requires a refund request. Fees incurred with your own API key are handled by the corresponding provider and cannot be refunded by this site. A task already submitted to a provider may not be immediately cancellable.",
        ] },
        { id: "request", title: "5. Requesting and following up", paragraphs: [
          "Sign in to the purchasing account, open Orders and refund requests, select a paid order and submit a reason and contact email or WeChat ID. Then contact support through the email or WeChat below. If you cannot sign in or submit the form, email us directly.",
          "Include the site order ID, payment date and amount, relevant task IDs and an explanation. Redact unrelated personal details in payment screenshots. Do not send card passwords, payment passwords, verification codes or API keys. We may require necessary account-ownership verification.",
          "Requests are handled manually. Timing depends on complete information and task and payment-channel checks. We communicate results through the ticket or your supplied contact. Review and payment-channel posting are separate stages; immediate arrival is not guaranteed. Uncertain refunds remain under investigation to avoid duplicate submissions.",
        ] },
        { id: "destination", title: "6. Payment channel and applicable rights", paragraphs: [
          "Approved refunds are processed through the original order's payment channel. Arrival times and refundable scope depend on the channel's actual processing and applicable rules. If the seller of record displayed at checkout resells the service, its order, refund and dispute terms may also apply; check the contact details on your receipt.",
          "This page does not mean a payment channel under review has been activated. Contact support with the order ID to dispute a result; remedies available under applicable law and payment-channel rules remain available.",
        ] },
      ],
    },
  },
};
