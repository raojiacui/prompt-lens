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
  useVideoConfig,
} from "remotion";

const ease = Easing.bezier(0.16, 1, 0.3, 1);
const clamp = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };

const colors = {
  bg: "#F7F3EC",
  ink: "#241617",
  muted: "#7A6258",
  line: "rgba(36, 22, 23, 0.14)",
  card: "rgba(255, 252, 246, 0.88)",
  accent: "#D97757",
};

const asset = {
  referenceVideo: staticFile("remotion/landing-ad/reference-video.mp4"),
  referenceStill: staticFile("remotion/landing-ad/reference-still.jpg"),
  walkthrough: staticFile("remotion/landing-ad/product-walkthrough.mp4"),
  logo: staticFile("prompt-lens-icon.png"),
};

function opacity(frame: number, input: number[]) {
  const values = input.map((_, index) => (index === 0 || index === input.length - 1 ? 0 : 1));
  return interpolate(frame, input, values, { ...clamp, easing: ease });
}

function Title({ from, to, kicker, title, subtitle }: { from: number; to: number; kicker?: string; title: string; subtitle?: string }) {
  const frame = useCurrentFrame();
  const local = frame - from;
  return (
    <div
      style={{
        position: "absolute",
        left: 86,
        bottom: 82,
        width: 980,
        opacity: opacity(frame, [from, from + 20, to - 18, to]),
        translate: `0 ${interpolate(local, [0, 28], [26, 0], { ...clamp, easing: ease })}px`,
      }}
    >
      {kicker ? <div style={kickerStyle}>{kicker}</div> : null}
      <div style={titleStyle}>{title}</div>
      {subtitle ? <div style={subtitleStyle}>{subtitle}</div> : null}
    </div>
  );
}

function ReferenceOpening() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg, overflow: "hidden" }}>
      <Video
        src={asset.referenceVideo}
        muted
        volume={0}
        style={{
          position: "absolute",
          width: "100%",
          height: "100%",
          objectFit: "cover",
          scale: interpolate(frame, [0, 150], [1.06, 1.13], { ...clamp, easing: ease, output: "perceptual-scale" }),
          opacity: opacity(frame, [0, 18, 126, 150]),
        }}
      />
      <div style={{ ...vignette, opacity: interpolate(frame, [0, 80], [0.26, 0.48], clamp) }} />
      <Title from={18} to={145} title="每一条视频，都有可复用的结构" subtitle="Prompt Lens reads the craft behind a reference shot." />
    </AbsoluteFill>
  );
}

function SceneCards() {
  const frame = useCurrentFrame();
  const cards = [
    { label: "Scene 01", text: "云海长廊 · 建立镜头", x: 184, y: 238, delay: 0 },
    { label: "Scene 02", text: "人物入画 · 服饰与动作", x: 548, y: 168, delay: 8 },
    { label: "Scene 03", text: "镜头推进 · 光线反射", x: 912, y: 256, delay: 16 },
    { label: "Scene 04", text: "空间延展 · 节奏转场", x: 1276, y: 186, delay: 24 },
  ];

  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg, overflow: "hidden" }}>
      <Img
        src={asset.referenceStill}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: opacity(frame, [130, 154, 270, 292]) * 0.42,
          scale: interpolate(frame, [150, 292], [1.08, 1.01], { ...clamp, easing: ease, output: "perceptual-scale" }),
          filter: "blur(8px) saturate(0.82)",
        }}
      />
      <div style={{ position: "absolute", inset: 0, background: "rgba(247,243,236,0.72)" }} />
      <Title from={154} to={286} kicker="Scene intelligence" title="先拆开，再看懂" subtitle="镜头、动作、光线和提示词，变成可编辑的创作资产" />
      {cards.map((card, index) => {
        const start = 170 + card.delay;
        const appear = interpolate(frame, [start, start + 26], [0, 1], { ...clamp, easing: ease });
        return (
          <div
            key={card.label}
            style={{
              ...sceneCardStyle,
              left: card.x,
              top: card.y,
              opacity: appear * opacity(frame, [150, 170, 274, 296]),
              translate: `0 ${interpolate(frame, [start, start + 26], [42, 0], { ...clamp, easing: ease })}px`,
              scale: interpolate(frame, [start, start + 26], [0.94, 1], { ...clamp, easing: ease, output: "perceptual-scale" }),
            }}
          >
            <div style={{ height: 110, borderRadius: 16, overflow: "hidden", background: "#111" }}>
              <Img src={asset.referenceStill} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: `${42 + index * 10}% center` }} />
            </div>
            <div style={{ marginTop: 18, fontSize: 24, fontWeight: 760, color: colors.ink }}>{card.label}</div>
            <div style={{ marginTop: 8, fontSize: 18, lineHeight: 1.35, color: colors.muted }}>{card.text}</div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

function ProductWorkflow() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg, overflow: "hidden" }}>
      <div style={softGlow} />
      <Title from={300} to={486} kicker="Prompt Lens" title="把参考视频，变成复刻 Prompt" subtitle="上传、拆镜、分析，一次完成" />
      <div
        style={{
          ...browserShellStyle,
          opacity: opacity(frame, [304, 334, 484, 510]),
          translate: `${interpolate(frame, [300, 350], [130, 0], { ...clamp, easing: ease })}px 0`,
          scale: interpolate(frame, [300, 350], [0.92, 1], { ...clamp, easing: ease, output: "perceptual-scale" }),
        }}
      >
        <div style={browserTopStyle}>
          <span style={{ ...dotStyle, background: "#F07963" }} />
          <span style={{ ...dotStyle, background: "#E7C160" }} />
          <span style={{ ...dotStyle, background: "#69B07A" }} />
          <div style={urlStyle}>prompt-lens.app / analyze</div>
        </div>
        <Video
          src={asset.walkthrough}
          muted
          volume={0}
          startFrom={220}
          style={{ width: "100%", height: "calc(100% - 52px)", objectFit: "cover", objectPosition: "center top" }}
        />
      </div>
    </AbsoluteFill>
  );
}

function PromptAsset() {
  const frame = useCurrentFrame();
  const lines = ["画面复刻", "镜头语言", "光线 / 色彩", "复刻 Prompt"];
  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg, overflow: "hidden" }}>
      <div style={softGlow} />
      <div
        style={{
          ...analysisPanelStyle,
          opacity: opacity(frame, [506, 532, 694, 720]),
          translate: `${interpolate(frame, [506, 560], [-88, 0], { ...clamp, easing: ease })}px 0`,
        }}
      >
        <div style={{ fontSize: 28, fontWeight: 780, color: colors.ink }}>Scene 01</div>
        <div style={{ marginTop: 8, fontSize: 18, color: colors.muted }}>0:00 - 0:02.2 · Analyzed</div>
        <Img src={asset.referenceStill} style={{ marginTop: 28, width: "100%", height: 260, objectFit: "cover", borderRadius: 22 }} />
        <div style={{ marginTop: 28, display: "grid", gap: 14 }}>
          {lines.map((line, index) => (
            <div
              key={line}
              style={{
                ...analysisLineStyle,
                opacity: interpolate(frame, [548 + index * 10, 568 + index * 10], [0, 1], { ...clamp, easing: ease }),
                translate: `0 ${interpolate(frame, [548 + index * 10, 568 + index * 10], [18, 0], { ...clamp, easing: ease })}px`,
              }}
            >
              <span style={{ color: colors.ink, fontWeight: 740 }}>{line}</span>
              <span style={{ color: colors.muted }}>可编辑</span>
            </div>
          ))}
        </div>
      </div>
      <div
        style={{
          ...promptCardStyle,
          opacity: opacity(frame, [548, 584, 706, 736]),
          translate: `${interpolate(frame, [548, 590], [90, 0], { ...clamp, easing: ease })}px 0`,
        }}
      >
        <div style={{ fontSize: 20, color: colors.accent, fontWeight: 760 }}>Reusable prompt</div>
        <div style={{ marginTop: 22, fontSize: 34, lineHeight: 1.45, color: colors.ink, fontWeight: 660 }}>
          电影感广角镜头，一位身穿红白汉服的女性沿着云海之上的巨大弧形长廊缓步前行。黑色镜面地板反射立柱与天光，远处空间不断延展，营造史诗、空灵、庄严的东方幻想氛围。
        </div>
      </div>
      <Title from={618} to={738} title="提示词不是结论，是下一步创作的起点" />
    </AbsoluteFill>
  );
}

function BrandClose() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
      <Img
        src={asset.referenceStill}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: opacity(frame, [722, 748, 884, 900]) * 0.22,
          filter: "blur(10px) saturate(0.7)",
          scale: interpolate(frame, [720, 900], [1.03, 1.12], { ...clamp, easing: ease, output: "perceptual-scale" }),
        }}
      />
      <div style={{ position: "absolute", inset: 0, background: "rgba(247,243,236,0.82)" }} />
      <div style={{ opacity: opacity(frame, [742, 778, 892, 900]), textAlign: "center", translate: `0 ${interpolate(frame, [742, 782], [30, 0], { ...clamp, easing: ease })}px` }}>
        <Img src={asset.logo} style={{ width: 96, height: 100, objectFit: "contain", margin: "0 auto 30px" }} />
        <div style={{ fontSize: 82, lineHeight: 1, fontWeight: 820, color: colors.ink, letterSpacing: 0 }}>Prompt Lens</div>
        <div style={{ marginTop: 26, fontSize: 34, color: colors.muted }}>看懂镜头，复刻表达</div>
      </div>
    </AbsoluteFill>
  );
}

export function PromptLensLandingAd() {
  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg }}>
      <Sequence from={0} durationInFrames={156}>
        <ReferenceOpening />
      </Sequence>
      <Sequence from={132} durationInFrames={170}>
        <SceneCards />
      </Sequence>
      <Sequence from={292} durationInFrames={224}>
        <ProductWorkflow />
      </Sequence>
      <Sequence from={506} durationInFrames={238}>
        <PromptAsset />
      </Sequence>
      <Sequence from={720} durationInFrames={180}>
        <BrandClose />
      </Sequence>
    </AbsoluteFill>
  );
}

const titleStyle: CSSProperties = {
  fontSize: 64,
  lineHeight: 1.08,
  letterSpacing: 0,
  fontWeight: 820,
  color: "#FFFFFF",
  textShadow: "0 18px 60px rgba(0,0,0,0.34)",
};

const subtitleStyle: CSSProperties = {
  marginTop: 20,
  fontSize: 26,
  lineHeight: 1.35,
  fontWeight: 520,
  color: "rgba(255,255,255,0.82)",
  textShadow: "0 12px 38px rgba(0,0,0,0.28)",
};

const kickerStyle: CSSProperties = {
  marginBottom: 18,
  fontSize: 18,
  fontWeight: 760,
  letterSpacing: 1.6,
  textTransform: "uppercase",
  color: colors.accent,
};

const vignette: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "linear-gradient(90deg, rgba(0,0,0,0.62), rgba(0,0,0,0.05) 58%, rgba(0,0,0,0.16))",
};

const softGlow: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "radial-gradient(circle at 70% 28%, rgba(217,119,87,0.18), transparent 34%), radial-gradient(circle at 18% 80%, rgba(255,255,255,0.85), transparent 42%)",
};

const sceneCardStyle: CSSProperties = {
  position: "absolute",
  width: 300,
  height: 244,
  padding: 18,
  borderRadius: 28,
  border: `1px solid ${colors.line}`,
  background: colors.card,
  boxShadow: "0 26px 80px rgba(75, 49, 39, 0.13)",
  backdropFilter: "blur(18px)",
};

const browserShellStyle: CSSProperties = {
  position: "absolute",
  right: 84,
  top: 128,
  width: 1100,
  height: 690,
  borderRadius: 32,
  overflow: "hidden",
  border: `1px solid ${colors.line}`,
  background: "#fffaf3",
  boxShadow: "0 40px 110px rgba(75, 49, 39, 0.18)",
};

const browserTopStyle: CSSProperties = {
  height: 52,
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "0 18px",
  background: "rgba(255,255,255,0.78)",
  borderBottom: `1px solid ${colors.line}`,
};

const dotStyle: CSSProperties = {
  width: 12,
  height: 12,
  borderRadius: 999,
};

const urlStyle: CSSProperties = {
  marginLeft: 18,
  height: 28,
  minWidth: 280,
  borderRadius: 999,
  background: "rgba(36,22,23,0.06)",
  color: colors.muted,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 14,
  fontWeight: 620,
};

const analysisPanelStyle: CSSProperties = {
  position: "absolute",
  left: 126,
  top: 118,
  width: 610,
  minHeight: 770,
  padding: 34,
  borderRadius: 34,
  border: `1px solid ${colors.line}`,
  background: colors.card,
  boxShadow: "0 34px 100px rgba(75, 49, 39, 0.14)",
};

const analysisLineStyle: CSSProperties = {
  height: 58,
  borderRadius: 18,
  border: `1px solid ${colors.line}`,
  background: "rgba(255,255,255,0.68)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 20px",
  fontSize: 20,
};

const promptCardStyle: CSSProperties = {
  position: "absolute",
  right: 118,
  top: 200,
  width: 880,
  minHeight: 430,
  padding: 42,
  borderRadius: 36,
  border: `1px solid ${colors.line}`,
  background: "rgba(255,255,255,0.86)",
  boxShadow: "0 36px 120px rgba(75, 49, 39, 0.16)",
};