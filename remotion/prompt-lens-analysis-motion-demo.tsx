import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Easing, Img, Video, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Check, Clipboard, Film, Lightbulb, MousePointer2, ScanLine, Sparkles, VideoIcon, WandSparkles } from "lucide-react";

const limit = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
const travel = Easing.bezier(.66, 0, .23, 1);
const land = Easing.bezier(.16, 1, .3, 1);
const bg = "#F7F2EA";
const ink = "#28262b";
const coral = "#d97757";
const video = staticFile("remotion/landing-ad/reference-video.mp4");
const logo = staticFile("prompt-lens-icon.png");
// Cut positions verified against the 24 fps source; the final endpoint includes its audio tail.
const cuts = [0, 53 / 24, 115 / 24, 177 / 24, 238 / 24, 300 / 24, 363 / 24, 424 / 24, 485 / 24, 23.030929];
const shots = cuts.slice(0, -1).map((start, i) => ({
  src: staticFile(`remotion/landing-ad/analysis-cut-${String(i + 1).padStart(2, "0")}.jpg`),
  range: `${start.toFixed(2)} - ${cuts[i + 1].toFixed(2)}s`,
  duration: `${(cuts[i + 1] - start).toFixed(2)}s`,
}));

function key(f: number, t: number[], v: number[], ease = travel) {
  return interpolate(f, t, v, { ...limit, easing: ease });
}
function show(f: number, start: number, end = start + 20) { return key(f, [start, end], [0, 1], land); }
type Point = { x: number; y: number; s: number; r: number };
function path(f: number, t: number[], p: Point[]): Point {
  return { x: key(f, t, p.map(a => a.x)), y: key(f, t, p.map(a => a.y)), s: key(f, t, p.map(a => a.s)), r: key(f, t, p.map(a => a.r)) };
}
function Float({ p, width, opacity = 1, blur = 0, z = 1, children }: { p: Point; width: number; opacity?: number; blur?: number; z?: number; children: ReactNode }) {
  return <div style={{ position: "absolute", left: p.x, top: p.y, width, opacity, zIndex: z, filter: `blur(${blur}px)`,
    transform: `translate(-50%, -50%) rotate(${p.r}deg) scale(${p.s})` }}>{children}</div>;
}
function Click({ f, start, at, x, y }: { f: number; start: number; at: number; x: number; y: number }) {
  const visible = show(f, start, start + 7) * (1 - show(f, at + 8, at + 21));
  return <div style={{ position: "absolute", left: x, top: y, opacity: visible, zIndex: 12,
    transform: `translate(${key(f, [start, at - 3], [100, 0], land)}px, ${key(f, [start, at - 3], [55, 0], land)}px) scale(${key(f, [at - 2, at + 3, at + 10], [1, .85, 1])})` }}>
    <MousePointer2 size={32} fill="white" stroke={ink} strokeWidth={1.5} style={{ filter: "drop-shadow(0 3px 3px #0003)" }} />
    <div style={{ position: "absolute", left: -14, top: -14, width: 34, height: 34, border: `2px solid ${coral}`, borderRadius: "50%",
      opacity: key(f, [at, at + 3, at + 18], [0, .65, 0]), transform: `scale(${key(f, [at, at + 18], [.6, 2])})` }} />
  </div>;
}
function Intro({ f }: { f: number }) {
  return <Float width={800} p={{ x: 600, y: 480, s: key(f, [0, 22, 72, 98], [.9, 1, 1, .78]), r: key(f, [0, 24], [-2, 0]) }}
    opacity={show(f, 0, 18) * (1 - show(f, 80, 97))} z={4}>
    <div style={{ ...card, overflow: "hidden" }}>
      <div style={{ ...bar, justifyContent: "space-between" }}><span style={{ display: "flex", alignItems: "center", gap: 10 }}><VideoIcon size={20} color={coral} />上传视频或图片进行分析</span><span style={{ fontSize: 14, color: "#959198" }}>reference-video.mp4</span></div>
      <div style={{ height: 360, background: "#141619", position: "relative", overflow: "hidden" }}>
        <Video src={video} muted style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        <div style={{ position: "absolute", top: 0, bottom: 0, width: 3, background: "#fff", boxShadow: "0 0 16px 3px #fff8", left: `${key(f, [59, 84], [0, 100])}%`, opacity: show(f, 59, 64) * (1 - show(f, 81, 88)) }} />
      </div>
      <div style={{ height: 82, padding: "0 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 15, color: "#88818a" }}>原视频 23.03 秒 · 自动-平衡</span>
        <div style={{ ...button, transform: `scale(${key(f, [56, 60, 68], [1, .95, 1])})` }}><WandSparkles size={20} />{f < 61 ? "视频分析" : "正在分析"}</div>
      </div>
      <Click f={f} start={33} at={59} x={680} y={461} />
    </div>
  </Float>;
}

function ShotGrid({ f }: { f: number }) {
  return <>{shots.map(({ src, range, duration }, i) => {
    const gx = 270 + (i % 3) * 330;
    const gy = 320 + Math.floor(i / 3) * 210;
    const start = 83 + i * 3;
    const p = path(f, [start, 124 + i * 3, 176, 211, 300, 339], [
      { x: 600, y: 480, s: i === 0 ? 2.7 : .87, r: (i - 3.5) * 2 },
      { x: gx, y: gy, s: 1, r: 0 }, { x: gx, y: gy, s: 1, r: 0 },
      i === 0 ? { x: 340, y: 475, s: 2, r: -1.5 } : { x: gx - 160, y: gy + 70, s: .8, r: -4 },
      i === 0 ? { x: 340, y: 475, s: 2, r: -1.5 } : { x: gx - 160, y: gy + 70, s: .8, r: -4 },
      i === 0 ? { x: 195, y: 474, s: 1.25, r: -4 } : { x: gx - 160, y: gy + 70, s: .8, r: -4 },
    ]);
    const visible = show(f, start, start + 13) * (i === 0 ? 1 : 1 - show(f, 177 + i * 2, 204 + i * 2));
    return <Float key={src} p={p} width={260} opacity={visible} z={i === 0 ? 6 : 2}>
      <div style={{ ...card, overflow: "hidden", borderColor: i === 0 && f > 166 ? "#d9775780" : "#e5e2e0" }}>
        <Img src={src} style={{ width: "100%", height: 117, objectFit: "cover", display: "block" }} />
        <div style={{ height: 64, padding: "0 14px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 7, fontSize: 14, fontWeight: 600 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>镜头 {String(i + 1).padStart(2, "0")}</span><span style={{ color: coral }}>{duration}</span></div>
          <div style={{ fontSize: 12, color: "#8b8289", fontVariantNumeric: "tabular-nums" }}>{range}</div>
        </div>
      </div>
    </Float>;
  })}</>;
}

const dimensions = [
  { Icon: VideoIcon, label: "画面复刻", detail: "金色龙纹深红墙壁、莲花栏杆与黑色反光地面。", color: "#bf694e" },
  { Icon: Film, label: "镜头语言", detail: "广角低机位，弧线引导视线，平滑跟随突出纵深。", color: "#5879a3" },
  { Icon: Lightbulb, label: "光线 / 色彩", detail: "云海方向的柔和侧逆光，红、白、黑、金鲜明对比。", color: "#9b843a" },
  { Icon: Sparkles, label: "角色 / 动作", detail: "红白古风长裙女子缓步前行，裙摆与飘带轻微摆动。", color: "#438675" },
];
function AnalysisLayers({ f }: { f: number }) {
  return <>{dimensions.map(({ Icon, label, detail, color }, i) => {
    const start = 209 + i * 16;
    const p = path(f, [start, start + 24, 299 + i * 4, 331 + i * 4], [
      { x: 1045, y: 303 + i * 116, s: .9, r: 3 }, { x: 884, y: 303 + i * 116, s: 1, r: 0 },
      { x: 884, y: 303 + i * 116, s: 1, r: 0 }, { x: 706, y: 414 + i * 20, s: .55, r: 0 },
    ]);
    return <Float key={label} p={p} width={378} opacity={show(f, start, start + 18) * (1 - show(f, 311 + i * 4, 335 + i * 4))} z={9}>
      <div style={{ ...card, height: 104, boxSizing: "border-box", padding: "13px 21px", display: "flex", gap: 15, alignItems: "center" }}>
        <Icon size={26} color={color} style={{ flexShrink: 0 }} /><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 19, fontWeight: 700 }}>{label}</div><div style={{ fontSize: 15, lineHeight: 1.45, color: "#827c86", marginTop: 6 }}>{detail}</div></div>
        <Check size={16} color={color} style={{ flexShrink: 0, opacity: show(f, start + 17) }} />
      </div>
    </Float>;
  })}</>;
}

function PromptResult({ f }: { f: number }) {
  const p = path(f, [312, 349, 382, 416], [
    { x: 735, y: 555, s: .83, r: 2 }, { x: 714, y: 540, s: 1, r: 0 },
    { x: 714, y: 540, s: 1, r: 0 }, { x: 650, y: 540, s: 1.03, r: 0 },
  ]);
  const pieces = [
    { text: "电影级广角镜头，", color: "#5879a3" },
    { text: "一名身穿红白相间飘逸古风长裙的女子，背对镜头，正走在一条宏伟的弧形长廊上。", color: ink },
    { text: "长廊左侧是带有金色龙纹浮雕的深红色墙壁，右侧是无尽的云海，栏杆柱头雕刻着莲花。地面是黑色光面材质，反射着廊柱。", color: ink },
    { text: "清晨暖色调阳光洒下，光影交错，极具纵深感。", color: "#a6842d" },
    { text: "超现实仙境风格，画面细节丰富，电影质感，高分辨率，平滑的运镜。", color: "#438675" },
  ];
  return <Float p={p} width={820} opacity={show(f, 316, 343)} z={8}>
    <div style={{ ...card, height: 535, boxSizing: "border-box", padding: 31, position: "relative", borderColor: "#d9775760", boxShadow: "0 30px 80px -20px #815b442e, 0 0 0 1px #d9775710" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 22, borderBottom: "1px solid #ece8e3" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 23, fontWeight: 700 }}><Sparkles color={coral} size={23} />复刻 Prompt</div>
        <span style={{ fontSize: 14, color: "#438675", opacity: show(f, 388, 401) }}>可直接复制</span>
      </div>
      <div style={{ paddingTop: 23, fontSize: 26, lineHeight: 1.65, fontWeight: 500 }}>
        {pieces.map((piece, i) => <span key={i} style={{ color: piece.color, opacity: show(f, 342 + i * 9, 353 + i * 9), filter: `blur(${key(f, [342 + i * 9, 354 + i * 9], [3, 0], land)}px)` }}>{piece.text}</span>)}
      </div>
      <div style={{ position: "absolute", bottom: 26, left: 31, right: 31, display: "flex", justifyContent: "space-between", alignItems: "center", opacity: show(f, 383, 398) }}>
        <span style={{ color: "#928890", fontSize: 14 }}>镜头 01 · 0.00 - 2.21s · 分析完成</span>
        <div style={{ ...button, background: f >= 417 ? "#438675" : coral, transform: `scale(${key(f, [412, 416, 424], [1, .95, 1])})` }}>
          {f >= 417 ? <Check size={18} /> : <Clipboard size={18} />}{f >= 417 ? "已复制" : "复制提示词"}
        </div>
      </div>
      <Click f={f} start={390} at={416} x={700} y={484} />
    </div>
  </Float>;
}

function Title({ f, start, end, children, subtitle }: { f: number; start: number; end: number; children: ReactNode; subtitle?: string }) {
  return <div style={{ position: "absolute", left: 55, top: 110, width: 1090, textAlign: "center", opacity: show(f, start, start + 19) * (1 - show(f, end, end + 13)),
    transform: `translateY(${key(f, [start, start + 23], [20, 0], land)}px)`, zIndex: 15 }}>
    <div style={{ fontSize: 45, lineHeight: 1.25, fontWeight: 750 }}>{children}</div>
    {subtitle && <div style={{ marginTop: 15, fontSize: 18, color: "#827982" }}>{subtitle}</div>}
  </div>;
}

export function PromptLensAnalysisMotionDemo() {
  const frame = useCurrentFrame();
  // Extend the detailed prompt reveal and reading pause without slowing earlier scenes.
  const f = interpolate(frame, [0, 342, 510, 600], [0, 342, 450, 540], limit);
  const times = [0, 26, 43, 57, 69, 81, 110, 140, 173, 207, 233, 282, 316, 350, 387, 397, 411, 428, 446, 450];
  const points: Point[] = [
    { x: 600, y: 480, s: .89, r: 0 }, { x: 600, y: 480, s: 1, r: 0 }, { x: 600, y: 480, s: 1, r: 0 },
    { x: 890, y: 688, s: 2.5, r: 0 }, { x: 890, y: 688, s: 2.5, r: 0 },
    { x: 890, y: 688, s: 2.5, r: 0 }, { x: 600, y: 474, s: .82, r: 0 },
    { x: 600, y: 474, s: .98, r: 0 }, { x: 600, y: 474, s: .98, r: 0 },
    { x: 470, y: 456, s: 1.15, r: -.7 }, { x: 600, y: 474, s: 1, r: 0 },
    { x: 630, y: 475, s: 1.075, r: 0 }, { x: 690, y: 475, s: 1.02, r: 0 },
    { x: 650, y: 475, s: 1.04, r: 0 }, { x: 714, y: 475, s: 1.12, r: 0 },
    { x: 714, y: 475, s: 1.12, r: 0 },
    { x: 950, y: 763, s: 2.5, r: 0 }, { x: 950, y: 763, s: 2.5, r: 0 },
    { x: 650, y: 475, s: 1.1, r: 0 }, { x: 650, y: 475, s: 1.1, r: 0 },
  ];
  const cam = path(f, times, points);
  const prev = path(Math.max(0, f - 1), times, points);
  const close = key(f, [450, 485], [0, 1]);
  const blur = Math.min(1.6, Math.hypot(cam.x - prev.x, cam.y - prev.y) * .055);
  return <AbsoluteFill style={{ background: bg, color: ink, fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif', letterSpacing: 0, overflow: "hidden" }}>
    <div style={{ position: "absolute", left: 44, top: 33, display: "flex", alignItems: "center", gap: 9, opacity: .8 * (1 - close) }}>
      <Img src={logo} style={{ width: 28, height: 29, objectFit: "contain" }} /><span style={{ fontSize: 16, fontWeight: 650 }}>Prompt Lens</span>
    </div>
    <Title f={f} start={0} end={43} subtitle="上传参考视频，开始分析">一条视频，拆出创作逻辑</Title>
    <Title f={f} start={115} end={179} subtitle="原视频 23.03 秒 · 自动拆分为 9 个镜头">自动拆镜。<span style={{ color: coral }}>每个镜头，一目了然。</span></Title>
    <Title f={f} start={207} end={301} subtitle="主体 · 镜头 · 光线 · 动作">看懂画面，更看懂<span style={{ color: coral }}>拍法</span></Title>
    <Title f={f} start={325} end={390} subtitle="逐镜分析，生成可直接复制的提示词">把精彩，变成<span style={{ color: coral }}>可复刻的 Prompt</span></Title>
    <div style={{ position: "absolute", left: 0, top: 0, width: 1200, height: 950, transformOrigin: "0 0", opacity: 1 - close,
      transform: `translate(600px, ${480 - close * 20}px) scale(${cam.s * (1 - close * .28)}) rotate(${cam.r}deg) translate(${-cam.x}px, ${-cam.y}px)`, filter: `blur(${blur + close * 9}px)` }}>
      {f < 100 && <Intro f={f} />}
      {f >= 83 && <ShotGrid f={f} />}
      <AnalysisLayers f={f} />
      <PromptResult f={f} />
      <div style={{ position: "absolute", left: 300, top: 866, width: 600, textAlign: "center", opacity: show(f, 143, 159) * (1 - show(f, 176, 191)), fontSize: 18, color: "#7e7580" }}>
        <span style={{ fontSize: 28, fontWeight: 750, color: coral }}>23.03 秒</span><span style={{ padding: "0 22px" }}>原视频 →</span><span style={{ fontSize: 28, fontWeight: 750, color: coral }}>9</span> 个独立镜头
      </div>
      <div style={{ position: "absolute", left: 756, top: 725, display: "flex", gap: 9, alignItems: "center", opacity: show(f, 280, 293) * (1 - show(f, 302, 316)), color: "#438675", fontSize: 17 }}><ScanLine size={19} />多维度分析完成</div>
    </div>
    <AbsoluteFill style={{ display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 23, opacity: show(f, 476, 504),
      transform: `translateY(${key(f, [476, 508], [25, 0], land)}px) scale(${key(f, [476, 508, 539], [.87, 1, 1.015], land)})`, filter: `blur(${key(f, [476, 501], [5, 0], land)}px)` }}>
      <Img src={logo} style={{ width: 116, height: 122, objectFit: "contain" }} />
      <div style={{ fontSize: 52, fontWeight: 750 }}>Prompt Lens</div>
      <div style={{ fontSize: 19, color: "#827982", opacity: show(f, 499, 517) }}>看懂好视频，提炼好提示词。</div>
    </AbsoluteFill>
  </AbsoluteFill>;
}
const card: CSSProperties = { background: "#fff", border: "1px solid #e5e2e0", borderRadius: 8, boxShadow: "0 24px 55px -22px #554b4838, 0 3px 8px #554b4808" };
const bar: CSSProperties = { height: 57, padding: "0 24px", display: "flex", alignItems: "center", fontSize: 18, fontWeight: 600 };
const button: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", gap: 9, height: 45, minWidth: 144, padding: "0 16px", borderRadius: 7, background: coral, color: "white", fontSize: 17, fontWeight: 600 };
