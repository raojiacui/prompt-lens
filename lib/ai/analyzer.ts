import axios from "axios";
import { db } from "@/lib/db";
import { userApiKeys } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

// 代理配置
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "http://127.0.0.1:7897";
function getAxiosProxy() {
  try {
    const url = new URL(proxyUrl);
    return {
      host: url.hostname,
      port: parseInt(url.port) || (url.protocol === "https:" ? 443 : 80),
      protocol: url.protocol.replace(":", ""),
    };
  } catch {
    return { host: "127.0.0.1", port: 7897, protocol: "http" };
  }
}
const axiosProxy = getAxiosProxy();

// API 配置
const API_CONFIGS = {
  zhipu: {
    url: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    model: "glm-4v-plus",
  },
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent",
    model: "gemini-2.0-flash-exp",
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/chat/completions",
    model: "anthropic/claude-3-haiku",  // 使用支持vision的稳定模型
  },
};

// 环境变量中的 API Keys
const ENV_API_KEYS = {
  zhipu: process.env.DEEPSEEK_API_KEY || null,
  openrouter: process.env.OPENROUTER_API_KEY || null,
  gemini: process.env.GEMINI_API_KEY || null,
};

export type ApiProvider = "zhipu" | "gemini" | "openrouter";

export interface AnalyzeOptions {
  userId: string;
  provider?: ApiProvider;
  frames: string[]; // base64 编码的图片数组
  mode: "single" | "batch";
}

export interface AnalyzeResult {
  success: boolean;
  prompt?: string;
  corePrompt?: string;
  error?: string;
}

/**
 * 获取 API Key - 优先使用环境变量，其次使用用户配置
 */
async function getUserApiKey(
  userId: string,
  provider: ApiProvider
): Promise<string | null> {
  // 1. 优先检查环境变量
  const envKey = ENV_API_KEYS[provider];
  if (envKey) {
    console.log(`[Analyzer] Using env API key for ${provider}`);
    return envKey;
  }

  // 2. 环境变量没有，则从数据库读取用户配置的 API Key
  const result = await db.query.userApiKeys.findFirst({
    where: and(
      eq(userApiKeys.userId, userId),
      eq(userApiKeys.provider, provider)
    ),
  });

  if (!result || !result.isActive) {
    return null;
  }

  return result.apiKey;
}

/**
 * 调用智谱AI API
 */
async function callZhipuApi(
  apiKey: string,
  messages: any[]
): Promise<string> {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const payload = {
    model: API_CONFIGS.zhipu.model,
    messages: messages,
    max_tokens: 4096,
    temperature: 0.7,
  };

  const response = await axios.post(API_CONFIGS.zhipu.url, payload, {
    headers,
    timeout: 180000,
    proxy: axiosProxy,
  });

  if (!response.data.choices || response.data.choices.length === 0) {
    throw new Error("API returned empty result");
  }

  return response.data.choices[0].message.content;
}

/**
 * 调用 Gemini API
 */
async function callGeminiApi(
  apiKey: string,
  images: string[],
  textPrompt: string
): Promise<string> {
  const contents = [];

  for (const img of images) {
    contents.push({
      role: "user",
      parts: [
        { inline_data: { mime_type: "image/jpeg", data: img.split(",")[1] } },
        { text: textPrompt },
      ],
    });
  }

  const payload = {
    contents,
    generationConfig: { maxOutputTokens: 4096 },
  };

  const url = `${API_CONFIGS.gemini.url}?key=${apiKey}`;
  const response = await axios.post(url, payload, {
    timeout: 180000,
    proxy: axiosProxy,
  });

  if (!response.data.candidates || response.data.candidates.length === 0) {
    throw new Error("API returned empty result");
  }

  return response.data.candidates[0].content.parts[0].text;
}

/**
 * 调用 OpenRouter API
 */
async function callOpenRouterApi(
  apiKey: string,
  messages: any[]
): Promise<string> {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://prompt-analyzer.com",
    "X-Title": "Prompt Analyzer",
  };

  const payload = {
    model: API_CONFIGS.openrouter.model,
    messages: messages,
    max_tokens: 4096,
  };

  console.log("[OpenRouter] Request:", { url: API_CONFIGS.openrouter.url, model: API_CONFIGS.openrouter.model, keyPrefix: apiKey.substring(0, 10) });

  const response = await axios.post(API_CONFIGS.openrouter.url, payload, {
    headers,
    timeout: 180000,
    proxy: axiosProxy,
  });

  console.log("[OpenRouter] Response status:", response.status, response.data);

  if (!response.data.choices || response.data.choices.length === 0) {
    throw new Error("API returned empty result");
  }

  return response.data.choices[0].message.content;
}

/**
 * 分析图片/帧
 */
export async function analyzeFrames(options: AnalyzeOptions): Promise<AnalyzeResult> {
  const { userId, provider = "zhipu", frames, mode } = options;

  // 获取用户 API Key
  const apiKey = await getUserApiKey(userId, provider);

  if (!apiKey) {
    const envKeyConfigured = ENV_API_KEYS[provider] ? " (env configured)" : "";
    return {
      success: false,
      error: `No API key found for ${provider}${envKeyConfigured}. Please configure your API key in settings or check .env file.`,
    };
  }

  // 准备提示词
  const prompt = mode === "batch" ? BATCH_ANALYSIS_PROMPT : SINGLE_ANALYSIS_PROMPT;

  try {
    let result: string;

    if (provider === "zhipu") {
      // 智谱AI
      const messages = [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            ...frames.map((frame) => ({
              type: "image_url",
              image_url: { url: frame },
            })),
          ],
        },
      ];
      result = await callZhipuApi(apiKey, messages);
    } else if (provider === "gemini") {
      // Gemini
      result = await callGeminiApi(apiKey, frames, prompt);
    } else {
      // OpenRouter (使用类似智谱的格式)
      const messages = [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            ...frames.map((frame) => ({
              type: "image_url",
              image_url: { url: frame },
            })),
          ],
        },
      ];
      result = await callOpenRouterApi(apiKey, messages);
    }

    // 提取核心提示词
    const corePrompt = extractCorePrompt(result);

    return {
      success: true,
      prompt: result,
      corePrompt,
    };
  } catch (error: any) {
    console.error("AI Analysis error:", error);
    return {
      success: false,
      error: error.message || "Analysis failed",
    };
  }
}

/**
 * 从结果中提取核心提示词
 */
function extractCorePrompt(result: string): string {
  // 尝试提取 "核心提示词：" 后面的内容
  const match = result.match(/核心提示词[：:]\s*([^\n]+)/);
  if (match) {
    return match[1].trim();
  }

  // 如果没有找到，返回第一行
  const lines = result.split("\n").filter((l) => l.trim());
  return lines[0]?.trim() || "";
}

// ============ 分析提示词模板 ============

const SINGLE_ANALYSIS_PROMPT = `# 视频镜头提示词反推专家

你是一位精通视觉语言和AI视频生成的提示词工程师。请对这张视频截图进行**专业级深度分析**，并输出可直接用于AI视频生成的结构化提示词。

---

## 📊 分析维度（请按以下顺序逐项分析）

### 一、画面主体 (Subject)
- **人物特征**：性别、年龄、外貌、表情、发型、妆容
- **人物动作**：姿态、手势、运动状态、朝向
- **服装配饰**：款式、颜色、材质、细节元素
- **其他主体**：动物/物体/图标等核心元素

### 二、环境场景 (Environment)
- **场景类型**：室内/室外/自然/城市/虚拟/抽象
- **具体场景**：街道/房间/森林/海滩/工作室等
- **时段天气**：清晨/正午/黄昏/深夜 + 晴/雨/雪/雾/风
- **背景元素**：建筑/植被/道具/招牌/装饰细节
- **空间深度**：前景/中层次关系

###景/背景的 三、镜头语言 (Camera)
- **拍摄角度**：平视/低角度仰拍/高角度俯拍/鸟瞰/虫眼/荷兰角
- **镜头景别**：极端远景(E LS)/远景(LS)/全景(FS)/中景(MS)/近景(MCU)/特写(CU)/大特写(ECU)
- **运镜方式**：固定/推镜头(Dolly In)/拉镜头(Dolly Out)/摇摄(Pan)/俯仰(Tilt)/跟随/环绕/手持晃动/滑动变焦
- **焦点控制**：合焦位置/景深浅深/焦点转移/背景虚化程度
- **构图法则**：三分法/黄金分割/引导线/框架构图/对称/居中/留白

### 四、光影照明 (Lighting)
- **光源类型**：自然光(日光/月光)/人造光(路灯/霓虹/室内灯/屏幕光)
- **光照方向**：顺光/侧光/逆光/顶光/底光
- **光比氛围**：柔和/强烈/高反差/低反差/剪影
- **特殊光效**：体积光/镜头光晕/反射光/辉光/阴影形状
- **色温色调**：暖调(金橙)/冷调(蓝青)/中性/赛博朋克霓虹

### 五、美术风格 (Style)
- **视觉风格**：写实/电影感/动漫/3D渲染/油画/水彩/复古胶片/赛博朋克/极简主义
- **色彩体系**：主色调/辅助色/点缀色 + 配色方案(互补/类比/单色)
- **饱和对比**：高饱和/低饱和/高对比/低对比/柔和/浓郁
- **质感材质**：光滑/粗糙/金属/织物/玻璃/液体/烟雾
- **后期处理**：胶片颗粒/色差/晕影/模糊/锐化/LUT滤镜

### 六、氛围情绪 (Mood)
- **情感基调**：宁静/紧张/温馨/孤独/浪漫/神秘/活力/忧郁/科幻感
- **叙事暗示**：故事背景/情节暗示/时间感/空间感
- **感官体验**：温度感/声音暗示/气味联想/触感
- **节奏动态**：静止/缓慢/快速/动荡

---

## 📝 输出格式（严格按此格式输出）

\`\`\`
═══════════════════════════════════════════════════════════════
【画面深度描述】
(用一段150-200字的文字，整体描述画面，包含主要视觉元素和整体感受，语言生动但精准)

═══════════════════════════════════════════════════════════════
【AI视频生成提示词】

📌 核心提示词：
(一行的精炼提示词，可直接用于AI视频生成，包含最关键的元素)

───────────────────────────────────────────────────────────────

🎬 主体详细：
• 人物：...
• 动作：...
• 服装：...

🏞️ 场景环境：
• 场景类型：...
• 时段天气：...
• 空间层次：...

📷 镜头语言：
• 角度：[xx度] [具体角度]
• 景别：[具体景别]
• 运镜：[运镜方式] + [速度描述]
• 焦点：[焦点描述]
• 构图：[构图法则]

💡 光影照明：
• 光源：...
• 方向：...
• 光比：...
• 色温：...

🎨 美术风格：
• 视觉风格：[xx风格]
• 色彩：[主色调] + [配色方案]
• 质感：...
• 后期：...

✨ 氛围情绪：
• 基调：...
• 叙事：...
• 节奏：...

───────────────────────────────────────────────────────────────

🔧 技术参数建议：
• 宽高比：[如 16:9 / 9:16 / 21:9]
• 运动强度：[静止/微动/中/剧烈]
• 时长建议：[建议秒数]
• 负面提示词：(避免的元素，如模糊、变形等)
\`\`\`

---

## ⚠️ 注意事项
1. 用词精准专业，避免模糊表述
2. 数值化描述优先（如"45度角"而非"斜角"）
3. 提示词优先级：主体 > 场景 > 镜头 > 光影 > 风格 > 氛围
4. 核心提示词要简洁有力，适合直接复制使用
5. 考虑AI视频生成的可实现性
`;

const BATCH_ANALYSIS_PROMPT = `# 视频镜头序列提示词反推专家

你是一位精通影视语言和AI视频生成的提示词工程师。这组截图来自**同一视频的不同帧**，请进行**序列级分析**。

---

## 📊 分析维度

### 一、时间连贯性 (Temporal Continuity)
- **帧间变化**：逐帧对比，识别主体、场景、光影的变化规律
- **运动轨迹**：分析人物/物体的运动路径和方向
- **时间流逝**：判断视频时间跨度（瞬间/数秒/更长）

### 二、镜头运动解析 (Camera Movement)
- **运镜类型**：推/拉/摇/仰/俯/跟随/环绕/手持
- **运动速度**：静止/缓慢/匀速/加速/减速/急速
- **运动轨迹**：直线/弧线/复杂路径
- **起止状态**：镜头起始位置和终止位置的关系

### 三、视觉一致性 (Visual Consistency)
- **风格统一**：色调、光影、质感的稳定性
- **变化点**：识别帧间的视觉突变（如切换场景/光线变化）
- **重复元素**：跨帧反复出现的视觉符号

### 四、叙事节奏 (Narrative Rhythm)
- **节奏类型**：静态/缓慢/中等/快速/动荡
- **情绪曲线**：情感基调的变化趋势
- **高潮点**：视觉冲击力最强的帧

---

## 📝 输出格式（严格按此格式输出）

\`\`\`
═══════════════════════════════════════════════════════════════
【视频整体分析】

📖 叙事概述：
(150字以内，描述这个片段的整体内容和故事)

───────────────────────────────────────────────────────────────

🎬 镜头运动分析：
• 运镜方式：[具体运镜类型]
• 运动方向：[描述运动轨迹]
• 运动速度：[速度描述]
• 镜头跨度：从[起始状态]到[结束状态]

═══════════════════════════════════════════════════════════════
【视觉风格统一分析】

🎨 风格特征：
• 整体风格：[xx风格]
• 色彩体系：[主色调] + [贯穿帧的配色]
• 光影模式：[统一的光照特征]
• 质感特征：[共同的质感元素]

───────────────────────────────────────────────────────────────

📊 逐帧关键差异：
帧1：[最突出的视觉特征/变化点]
帧2：[相对于帧1的变化]
帧3：[相对于帧2的变化]
...（以此类推）

═══════════════════════════════════════════════════════════════
【AI视频复现提示词】

📌 核心提示词：
(一行精炼提示词，可直接用于AI视频生成，包含运镜、主体、场景的核心描述)

───────────────────────────────────────────────────────────────

🎬 运镜参数：
• 类型：[运镜类型]
• 速度：[速度描述]
• 方向：[运动方向]

👥 主体元素：
• 主要主体：[跨帧出现的主要元素]
• 动作变化：[动作的演变]

🏞️ 场景设定：
• 场景类型：...
• 持续元素：[贯穿始终的场景特征]

💡 光影风格：
• 统一光照：...
• 色调倾向：...

🎨 美术风格：
• 视觉风格：...
• 关键特征：[3-5个关键词]

✨ 氛围情绪：
• 基调：...
• 节奏：...

───────────────────────────────────────────────────────────────

🔧 技术参数建议：
• 宽高比：[如 16:9]
• 时长建议：[建议秒数，基于帧间变化推断]
• 运动强度：[静止/微动/中/剧烈]
• 负面提示词：(避免的元素)
\`\`\`

---

## ⚠️ 注意事项
1. 重点关注**帧间变化**和**运镜规律**
2. 提示词要能复现出"动态感"而非静态画面
3. 核心提示词需包含运镜描述
4. 推断合理的视频时长
`;
