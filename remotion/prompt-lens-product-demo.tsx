import type { CSSProperties } from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  Video,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { Check, ChevronRight, Clipboard, MousePointer2, Play, ScanLine, Sparkles, WandSparkles } from "lucide-react";

const fps = 30;
const DURATION = 378;
const ease = Easing.bezier(0.16, 1, 0.3, 1);
const clamp = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };

const c = {
  bg: "#f6f3ed",
  ink: "#231617",
  muted: "#826a60",
  line: "rgba(35,22,23,0.13)",
  card: "rgba(255,252,246,0.92)",
  accent: "#D97757",
  accentDark: "#bf5d42",
  green: "#2f9b73",
};

const assets = {
  walkthrough: staticFile("remotion/landing-ad/product-walkthrough.mp4"),
  referenceVideo: staticFile("remotion/landing-ad/reference-video.mp4"),
  still: staticFile("remotion/landing-ad/reference-still.jpg"),
  logo: staticFile("prompt-lens-icon.png"),
};

function fade(frame: number, start: number, end = start + 16) {
  return interpolate(frame, [start, end], [0, 1], { ...clamp, easing: ease });
}

function exit(frame: number, start: number, end = start + 16) {
  return interpolate(frame, [start, end], [1, 0], { ...clamp, easing: ease });
}

function rise(frame: number, start: number, distance = 24) {
  return interpolate(frame, [start, start + 18], [distance, 0], { ...clamp, easing: ease });
}

function TitleBlock({ start, eyebrow, title, subtitle, dark = false }: { start: number; eyebrow?: string; title: string; subtitle?: string; dark?: boolean }) {
  const frame = useCurrentFrame();
  return (
    <div style={{ opacity: fade(frame, start), translate: `0 ${rise(frame, start, 22)}px` }}>
      {eyebrow ? <div style={{ fontSize: 19, fontWeight: 760, color: c.accent, letterSpacing: 0, marginBottom: 12 }}>{eyebrow}</div> : null}
      <div style={{ fontSize: 54, lineHeight: 1.04, fontWeight: 820, color: dark ? "white" : c.ink, letterSpacing: 0 }}>{title}</div>
      {subtitle ? <div style={{ marginTop: 16, fontSize: 23, lineHeight: 1.35, color: dark ? "rgba(255,255,255,0.76)" : c.muted, fontWeight: 520 }}>{subtitle}</div> : null}
    </div>
  );
}

function BrowserFrame({ children, style, title = "Prompt Lens" }: { children: React.ReactNode; style?: CSSProperties; title?: string }) {
  return (
    <div style={{ border: `1px solid ${c.line}`, borderRadius: 30, background: c.card, boxShadow: "0 30px 100px rgba(88,58,46,0.16)", overflow: "hidden", ...style }}>
      <div style={{ height: 50, borderBottom: `1px solid ${c.line}`, display: "flex", alignItems: "center", gap: 10, padding: "0 20px", background: "rgba(255,255,255,0.78)", color: c.muted, fontSize: 15, fontWeight: 650 }}>
        <span style={{ width: 12, height: 12, borderRadius: 999, background: "#ff6b5f" }} />
        <span style={{ width: 12, height: 12, borderRadius: 999, background: "#f4c65b" }} />
        <span style={{ width: 12, height: 12, borderRadius: 999, background: "#62c77d" }} />
        <span style={{ marginLeft: 12 }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function HeroScene() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={baseStyle}>
      <div style={gradientStyle} />
      <div style={{ position: "absolute", left: 58, top: 56, display: "flex", alignItems: "center", gap: 12, opacity: fade(frame, 0) }}>
        <Img src={assets.logo} style={{ width: 38, height: 40, objectFit: "contain" }} />
        <span style={{ fontSize: 22, fontWeight: 820, color: c.ink }}>Prompt Lens</span>
      </div>
      <div style={{ position: "absolute", left: 58, top: 162, width: 430 }}>
        <TitleBlock start={2} eyebrow="VIDEO PROMPT ANALYZER" title="把参考视频拆成可复刻提示词" subtitle="上传视频或图片，自动识别镜头、画面、动作和风格。" />
        <div style={{ display: "flex", gap: 12, marginTop: 30, opacity: fade(frame, 24), translate: `0 ${rise(frame, 24, 16)}px` }}>
          <StepPill active icon={<Play size={18} />} text="Upload" />
          <StepPill icon={<ScanLine size={18} />} text="Analyze" />
          <StepPill icon={<Clipboard size={18} />} text="Prompt" />
        </div>
      </div>
      <BrowserFrame style={{ position: "absolute", right: 54, top: 84, width: 610, height: 478, opacity: fade(frame, 10), translate: `0 ${rise(frame, 10, 36)}px`, scale: interpolate(frame, [10, 56], [0.96, 1], { ...clamp, easing: ease, output: "perceptual-scale" }) }}>
        <div style={{ height: 428, position: "relative", background: "#111", overflow: "hidden" }}>
          <Video src={assets.referenceVideo} muted volume={0} style={{ width: "100%", height: "100%", objectFit: "cover", scale: interpolate(frame, [10, 88], [1.07, 1.16], { ...clamp, easing: ease, output: "perceptual-scale" }) }} />
          <div style={{ position: "absolute", left: 26, bottom: 24, right: 26, borderRadius: 22, background: "rgba(255,255,255,0.88)", padding: "16px 18px", opacity: fade(frame, 36), display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: c.ink }}>reference-video.mp4</div>
              <div style={{ marginTop: 4, fontSize: 13, color: c.muted }}>23s · 8 scenes detected</div>
            </div>
            <div style={{ width: 42, height: 42, borderRadius: 999, background: c.accent, display: "grid", placeItems: "center", color: "white" }}><Check size={22} /></div>
          </div>
        </div>
      </BrowserFrame>
      <Cursor path={[ [760, 645], [970, 505], [1005, 520] ]} start={42} clickAt={74} />
    </AbsoluteFill>
  );
}

function UiWalkthroughScene() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={baseStyle}>
      <div style={gradientStyle} />
      <div style={{ position: "absolute", left: 56, top: 56, width: 400 }}>
        <TitleBlock start={4} eyebrow="REAL WORKFLOW" title="录屏演示，而不是概念动画" subtitle="把上传、拆镜和分析结果压缩成一个清晰的产品流程。" />
        <div style={{ marginTop: 28, display: "grid", gap: 12 }}>
          {["上传参考视频", "自动拆分镜头", "右侧结果区滚动查看"].map((item, index) => (
            <FeatureRow key={item} frame={frame} start={26 + index * 12} text={item} />
          ))}
        </div>
      </div>
      <BrowserFrame title="prompt-lens.app / dashboard" style={{ position: "absolute", right: 42, top: 52, width: 710, height: 720, opacity: fade(frame, 6), translate: `${interpolate(frame, [0, 42], [80, 0], { ...clamp, easing: ease })}px 0` }}>
        <div style={{ height: 670, overflow: "hidden", position: "relative", background: "#f6f3ed" }}>
          <Video src={assets.walkthrough} muted volume={0} playbackRate={3.2} startFrom={0} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top", scale: interpolate(frame, [0, 150], [1.12, 1.18], { ...clamp, easing: ease, output: "perceptual-scale" }) }} />
          <div style={{ position: "absolute", inset: 0, boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.35)" }} />
          <div style={{ position: "absolute", right: 22, top: 22, borderRadius: 999, padding: "10px 14px", background: "rgba(255,255,255,0.92)", color: c.accentDark, fontSize: 14, fontWeight: 800, opacity: fade(frame, 42) }}>Live UI capture</div>
        </div>
      </BrowserFrame>
      <Cursor path={[ [640, 320], [845, 432], [918, 510] ]} start={46} clickAt={94} />
    </AbsoluteFill>
  );
}

function AnalysisRevealScene() {
  const frame = useCurrentFrame();
  const cards = [
    { t: "Scene 01", d: "云海长廊 · 广角建立镜头" },
    { t: "Scene 02", d: "人物移动 · 汉服飘带动作" },
    { t: "Scene 03", d: "镜面地板 · 光线反射" },
  ];
  return (
    <AbsoluteFill style={baseStyle}>
      <div style={gradientStyle} />
      <div style={{ position: "absolute", left: 52, top: 54, right: 52, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ width: 450 }}>
          <TitleBlock start={0} eyebrow="SCENE BREAKDOWN" title="每个镜头，都变成结构化资产" subtitle="画面、角色、动作、镜头语言和复刻 Prompt 分层呈现。" />
        </div>
        <div style={{ display: "flex", gap: 10, opacity: fade(frame, 20) }}>
          <StepPill active icon={<ScanLine size={18} />} text="8 scenes" />
          <StepPill icon={<Sparkles size={18} />} text="Chinese prompts" />
        </div>
      </div>
      <div style={{ position: "absolute", left: 54, bottom: 64, width: 514, height: 306, borderRadius: 30, overflow: "hidden", boxShadow: "0 24px 70px rgba(88,58,46,0.18)", opacity: fade(frame, 20), translate: `0 ${rise(frame, 20, 30)}px` }}>
        <Img src={assets.still} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
      <div style={{ position: "absolute", right: 54, top: 220, width: 548, display: "grid", gap: 14 }}>
        {cards.map((card, index) => (
          <div key={card.t} style={{ ...sceneCard, opacity: fade(frame, 32 + index * 14), translate: `${interpolate(frame, [32 + index * 14, 54 + index * 14], [58, 0], { ...clamp, easing: ease })}px 0` }}>
            <div style={{ width: 74, height: 56, borderRadius: 16, overflow: "hidden", background: "#111" }}><Img src={assets.still} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: `${32 + index * 18}% center` }} /></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 20, fontWeight: 820, color: c.ink }}>{card.t}</div>
              <div style={{ marginTop: 5, fontSize: 16, color: c.muted }}>{card.d}</div>
            </div>
            <div style={{ width: 34, height: 34, borderRadius: 999, background: index === 0 ? c.accent : "rgba(217,119,87,0.13)", display: "grid", placeItems: "center", color: index === 0 ? "white" : c.accent }}><ChevronRight size={18} /></div>
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", left: 606, bottom: 78, width: 520, borderRadius: 28, border: `1px solid ${c.line}`, background: "rgba(255,255,255,0.86)", padding: 24, boxShadow: "0 22px 80px rgba(88,58,46,0.13)", opacity: fade(frame, 88), translate: `0 ${rise(frame, 88, 24)}px` }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: c.accent }}>复刻 Prompt</div>
        <div style={{ marginTop: 12, fontSize: 23, lineHeight: 1.42, fontWeight: 650, color: c.ink }}>电影感广角镜头，红白汉服人物沿云海长廊前行，黑色镜面地板反射立柱与天光，东方幻想氛围。</div>
      </div>
    </AbsoluteFill>
  );
}

function CloseScene() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ ...baseStyle, background: c.ink }}>
      <Img src={assets.still} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.18, filter: "blur(4px) saturate(0.8)", scale: interpolate(frame, [0, 90], [1.04, 1.12], { ...clamp, easing: ease, output: "perceptual-scale" }) }} />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(35,22,23,0.92), rgba(35,22,23,0.56))" }} />
      <div style={{ position: "absolute", left: 72, top: 128, width: 570, opacity: fade(frame, 0), translate: `0 ${rise(frame, 0, 26)}px` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Img src={assets.logo} style={{ width: 54, height: 56, objectFit: "contain" }} />
          <div style={{ fontSize: 32, color: "white", fontWeight: 840 }}>Prompt Lens</div>
        </div>
        <div style={{ marginTop: 44, fontSize: 68, lineHeight: 1.03, fontWeight: 840, color: "white" }}>看懂镜头，复刻表达</div>
        <div style={{ marginTop: 22, fontSize: 27, lineHeight: 1.35, color: "rgba(255,255,255,0.72)" }}>AI video prompt analyzer for creators.</div>
      </div>
      <div style={{ position: "absolute", right: 78, bottom: 86, display: "flex", alignItems: "center", gap: 12, opacity: fade(frame, 44) }}>
        <div style={{ height: 62, borderRadius: 18, background: c.accent, color: "white", display: "flex", alignItems: "center", gap: 12, padding: "0 24px", fontSize: 22, fontWeight: 820 }}>Start analyzing <WandSparkles size={24} /></div>
      </div>
    </AbsoluteFill>
  );
}

export function PromptLensProductDemo() {
  return (
    <AbsoluteFill style={baseStyle}>
      <Sequence from={0} durationInFrames={96}><HeroScene /></Sequence>
      <Sequence from={90} durationInFrames={132}><UiWalkthroughScene /></Sequence>
      <Sequence from={210} durationInFrames={108}><AnalysisRevealScene /></Sequence>
      <Sequence from={306} durationInFrames={72}><CloseScene /></Sequence>
    </AbsoluteFill>
  );
}

function StepPill({ text, icon, active = false }: { text: string; icon?: React.ReactNode; active?: boolean }) {
  return <div style={{ display: "inline-flex", alignItems: "center", gap: 8, borderRadius: 999, padding: "11px 15px", background: active ? c.accent : "rgba(255,255,255,0.82)", color: active ? "white" : c.accentDark, fontSize: 15, fontWeight: 800, boxShadow: active ? "0 14px 34px rgba(217,119,87,0.24)" : "none" }}>{icon}{text}</div>;
}

function FeatureRow({ frame, start, text }: { frame: number; start: number; text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, opacity: fade(frame, start), translate: `0 ${rise(frame, start, 16)}px` }}>
      <div style={{ width: 28, height: 28, borderRadius: 999, background: "rgba(47,155,115,0.12)", color: c.green, display: "grid", placeItems: "center" }}><Check size={16} /></div>
      <div style={{ fontSize: 20, color: c.ink, fontWeight: 680 }}>{text}</div>
    </div>
  );
}

function Cursor({ path, start, clickAt }: { path: Array<[number, number]>; start: number; clickAt: number }) {
  const frame = useCurrentFrame();
  const [p0, p1, p2] = path;
  const x = interpolate(frame, [start, start + 30, start + 54], [p0[0], p1[0], p2[0]], { ...clamp, easing: ease });
  const y = interpolate(frame, [start, start + 30, start + 54], [p0[1], p1[1], p2[1]], { ...clamp, easing: ease });
  const visible = fade(frame, start - 8) * exit(frame, clickAt + 26);
  return (
    <>
      <MousePointer2 size={42} color={c.ink} fill="white" style={{ position: "absolute", left: x, top: y, opacity: visible, scale: interpolate(frame, [clickAt, clickAt + 5, clickAt + 14], [1, 0.86, 1], { ...clamp, easing: ease }) }} />
      <div style={{ position: "absolute", left: x - 6, top: y - 6, width: 46, height: 46, borderRadius: 999, border: `3px solid ${c.accent}`, opacity: interpolate(frame, [clickAt, clickAt + 6, clickAt + 24], [0, 0.8, 0], { ...clamp, easing: ease }), scale: interpolate(frame, [clickAt, clickAt + 24], [0.35, 1.8], { ...clamp, easing: ease }) }} />
    </>
  );
}

const baseStyle: CSSProperties = {
  fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
  background: c.bg,
  color: c.ink,
  overflow: "hidden",
};

const gradientStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "radial-gradient(circle at 78% 8%, rgba(217,119,87,0.16), transparent 34%), radial-gradient(circle at 8% 88%, rgba(255,255,255,0.9), transparent 42%)",
};

const sceneCard: CSSProperties = {
  height: 86,
  borderRadius: 24,
  border: `1px solid ${c.line}`,
  background: "rgba(255,255,255,0.88)",
  boxShadow: "0 18px 60px rgba(88,58,46,0.11)",
  display: "flex",
  alignItems: "center",
  gap: 16,
  padding: 15,
};