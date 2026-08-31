import type { CSSProperties, ReactNode } from "react";
import { fontFamily as dmSans, loadFont } from "@remotion/google-fonts/DMSans";
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
import {
  Clipboard,
  Film,
  Lightbulb,
  MousePointer2,
  ScanLine,
  Sparkles,
  Upload,
  VideoIcon,
  WandSparkles,
} from "lucide-react";

loadFont("normal", { weights: ["400", "500", "600", "700", "800", "900"] });

const ease = Easing.bezier(0.16, 1, 0.3, 1);
const clamp = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };

const c = {
  bg: "#f6f1e9",
  panel: "#fffdf8",
  ink: "#241516",
  muted: "#7b6258",
  faint: "#efe5d9",
  line: "rgba(36,21,22,0.13)",
  orange: "#d97757",
  orangeDark: "#bd5f43",
  green: "#2f9b73",
  blue: "#5277d9",
};

const assets = {
  still: staticFile("remotion/landing-ad/reference-still.jpg"),
  referenceVideo: staticFile("remotion/landing-ad/reference-video.mp4"),
  logo: staticFile("prompt-lens-icon.png"),
};

function fade(frame: number, start: number, end = start + 18) {
  return interpolate(frame, [start, end], [0, 1], { ...clamp, easing: ease });
}

function out(frame: number, start: number, end = start + 18) {
  return interpolate(frame, [start, end], [1, 0], { ...clamp, easing: ease });
}

function rise(frame: number, start: number, distance = 28) {
  return interpolate(frame, [start, start + 20], [distance, 0], { ...clamp, easing: ease });
}

function scaleIn(frame: number, start: number, from = 0.96) {
  return interpolate(frame, [start, start + 24], [from, 1], { ...clamp, easing: ease, output: "perceptual-scale" });
}

function Background() {
  return (
    <AbsoluteFill style={{ background: c.bg }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 82% 12%, rgba(217,119,87,0.16), transparent 35%), radial-gradient(circle at 5% 88%, rgba(255,255,255,0.9), transparent 42%)" }} />
      <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(36,21,22,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(36,21,22,0.035) 1px, transparent 1px)", backgroundSize: "42px 42px", opacity: 0.5 }} />
    </AbsoluteFill>
  );
}

function Browser({ children, style, title = "Prompt Lens" }: { children: ReactNode; style?: CSSProperties; title?: string }) {
  return (
    <div style={{ borderRadius: 30, border: `1px solid ${c.line}`, background: "rgba(255,253,248,0.92)", overflow: "hidden", boxShadow: "0 34px 110px rgba(92,58,43,0.16)", ...style }}>
      <div style={{ height: 52, borderBottom: `1px solid ${c.line}`, display: "flex", alignItems: "center", gap: 10, padding: "0 20px", color: c.muted, fontSize: 15, fontWeight: 700, background: "rgba(255,255,255,0.72)" }}>
        <span style={{ width: 12, height: 12, borderRadius: 999, background: "#ff6b5f" }} />
        <span style={{ width: 12, height: 12, borderRadius: 999, background: "#f4c65b" }} />
        <span style={{ width: 12, height: 12, borderRadius: 999, background: "#62c77d" }} />
        <span style={{ marginLeft: 12 }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function Headline({ eyebrow, title, subtitle, style, start = 0, dark = false }: { eyebrow?: string; title: string; subtitle?: string; style?: CSSProperties; start?: number; dark?: boolean }) {
  const frame = useCurrentFrame();
  return (
    <div style={{ opacity: fade(frame, start), translate: `0 ${rise(frame, start, 24)}px`, ...style }}>
      {eyebrow ? <div style={{ fontSize: 18, fontWeight: 820, color: c.orange, marginBottom: 14, letterSpacing: 0 }}>{eyebrow}</div> : null}
      <div style={{ fontSize: 66, lineHeight: 1, letterSpacing: 0, fontWeight: 900, color: dark ? "white" : c.ink }}>{title}</div>
      {subtitle ? <div style={{ marginTop: 18, fontSize: 21, lineHeight: 1.28, color: dark ? "rgba(255,255,255,0.74)" : c.muted, fontWeight: 650 }}>{subtitle}</div> : null}
    </div>
  );
}

function Cursor({ start, from, to, clickAt }: { start: number; from: [number, number]; to: [number, number]; clickAt: number }) {
  const frame = useCurrentFrame();
  const x = interpolate(frame, [start, start + 42], [from[0], to[0]], { ...clamp, easing: ease });
  const y = interpolate(frame, [start, start + 42], [from[1], to[1]], { ...clamp, easing: ease });
  return (
    <>
      <MousePointer2 size={44} fill="white" color={c.ink} style={{ position: "absolute", left: x, top: y, opacity: fade(frame, start - 8) * out(frame, clickAt + 30), scale: interpolate(frame, [clickAt, clickAt + 5, clickAt + 13], [1, 0.84, 1], { ...clamp, easing: ease }) }} />
      <div style={{ position: "absolute", left: x - 8, top: y - 8, width: 48, height: 48, borderRadius: 999, border: `3px solid ${c.orange}`, opacity: interpolate(frame, [clickAt, clickAt + 6, clickAt + 28], [0, 0.82, 0], { ...clamp, easing: ease }), scale: interpolate(frame, [clickAt, clickAt + 28], [0.3, 1.9], { ...clamp, easing: ease }) }} />
    </>
  );
}

function UploadScene() {
  const frame = useCurrentFrame();
  const uploadProgress = interpolate(frame, [72, 116], [0, 1], clamp);
  return (
    <AbsoluteFill style={base}>
      <Background />
      <div style={brandStyle}><Img src={assets.logo} style={{ width: 36, height: 38, objectFit: "contain" }} /><span>Prompt Lens</span></div>
      <Headline start={4} eyebrow="STEP 1" title="上传参考" subtitle="Video in" style={{ position: "absolute", left: 66, top: 160, width: 440 }} />
      <Browser title="prompt-lens.app / analyze" style={{ position: "absolute", right: 62, top: 82, width: 642, height: 700, opacity: fade(frame, 10), translate: `0 ${rise(frame, 10, 38)}px`, scale: scaleIn(frame, 10) }}>
        <div style={{ height: 648, padding: 28, display: "grid", gridTemplateRows: "1fr auto", gap: 20 }}>
          <div style={{ borderRadius: 28, border: `2px dashed ${frame > 54 ? c.orange : c.line}`, background: frame > 54 ? "rgba(217,119,87,0.08)" : "rgba(255,255,255,0.62)", display: "grid", placeItems: "center", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", inset: 16, borderRadius: 24, overflow: "hidden", opacity: fade(frame, 64) }}>
              <Video src={assets.referenceVideo} muted volume={0} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
            <div style={{ opacity: out(frame, 62) }}>
              <Upload size={48} color={c.orange} />
              <div style={{ marginTop: 16, fontSize: 26, fontWeight: 800, color: c.ink }}>Drop video here</div>
              <div style={{ marginTop: 8, fontSize: 17, color: c.muted }}>Reference video · image · short clip</div>
            </div>
            <div style={{ position: "absolute", left: 26, right: 26, bottom: 24, opacity: fade(frame, 78) }}>
              <div style={{ display: "flex", justifyContent: "space-between", color: "white", textShadow: "0 6px 18px rgba(0,0,0,0.35)", fontSize: 17, fontWeight: 760, marginBottom: 10 }}><span>reference-video.mp4</span><span>{Math.round(uploadProgress * 100)}%</span></div>
              <div style={{ height: 8, borderRadius: 999, background: "rgba(255,255,255,0.35)", overflow: "hidden" }}><div style={{ height: "100%", width: `${uploadProgress * 100}%`, background: c.orange, borderRadius: 999 }} /></div>
            </div>
          </div>
          <button style={{ height: 64, border: 0, borderRadius: 20, background: c.orange, color: "white", fontSize: 22, fontWeight: 850, display: "flex", alignItems: "center", justifyContent: "center", gap: 12, opacity: fade(frame, 30), scale: interpolate(frame, [128, 136, 146], [1, 0.96, 1], { ...clamp, easing: ease }) }}><WandSparkles size={24} /> Analyze Video</button>
        </div>
      </Browser>
      <Cursor start={28} from={[760, 570]} to={[1034, 713]} clickAt={132} />
    </AbsoluteFill>
  );
}

function SplittingScene() {
  const frame = useCurrentFrame();
  const scenes = [
    { label: "01", time: "0.0s - 2.2s", frame: 0, note: "Opening frame", pos: "20% center" },
    { label: "02", time: "2.2s - 4.8s", frame: 42, note: "Camera move", pos: "34% center" },
    { label: "03", time: "4.8s - 8.1s", frame: 78, note: "Subject action", pos: "48% center" },
    { label: "04", time: "8.1s - 12.4s", frame: 116, note: "Light shift", pos: "62% center" },
    { label: "05", time: "12.4s - 16.0s", frame: 154, note: "Wide view", pos: "76% center" },
    { label: "06", time: "16.0s - 19.6s", frame: 192, note: "Detail insert", pos: "32% top" },
    { label: "07", time: "19.6s - 23.1s", frame: 230, note: "Pacing beat", pos: "58% top" },
    { label: "08", time: "23.1s - 27.0s", frame: 268, note: "Closing shot", pos: "82% center" },
  ];
  return (
    <AbsoluteFill style={base}>
      <Background />
      <Headline start={0} eyebrow="STEP 2" title="自动拆镜" subtitle="8 scenes detected" style={{ position: "absolute", left: 66, top: 70, width: 430 }} />
      <div style={{ position: "absolute", right: 76, top: 88, borderRadius: 999, padding: "12px 18px", background: "rgba(255,255,255,0.82)", border: `1px solid ${c.line}`, display: "flex", gap: 10, alignItems: "center", fontSize: 17, fontWeight: 820, color: c.orange, opacity: fade(frame, 72) }}><Film size={20} /> 8 scenes detected</div>
      <div style={{ position: "absolute", left: 66, right: 66, top: 236, height: 620 }}>
        <div style={{ position: "absolute", left: 28, top: 18, bottom: 18, width: 4, background: "rgba(36,21,22,0.11)", borderRadius: 999, opacity: fade(frame, 26) }} />
        <div style={{ position: "absolute", left: 28, top: 18, width: 4, height: `${interpolate(frame, [28, 126], [0, 584], clamp)}px`, background: c.orange, borderRadius: 999, opacity: fade(frame, 26) }} />
        {scenes.map((scene, index) => {
          const start = 28 + index * 11;
          return (
            <div key={scene.label} style={{ position: "absolute", left: 0, right: 0, top: index * 74, height: 62, opacity: fade(frame, start), translate: `0 ${rise(frame, start, 22)}px` }}>
              <div style={{ position: "absolute", left: 18, top: 20, width: 24, height: 24, borderRadius: 999, background: c.orange, boxShadow: "0 0 0 8px rgba(217,119,87,0.12)" }} />
              <div style={{ position: "absolute", left: 72, right: 0, top: 0, height: 62, borderRadius: 20, overflow: "hidden", background: "rgba(255,253,248,0.95)", border: `1px solid ${c.line}`, boxShadow: "0 14px 38px rgba(88,58,46,0.09)", display: "grid", gridTemplateColumns: "112px 1fr 180px", alignItems: "center" }}>
                <div style={{ height: 62, background: "#111", overflow: "hidden" }}>
                  <Video src={assets.referenceVideo} startFrom={scene.frame} muted volume={0} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: scene.pos }} />
                </div>
                <div style={{ padding: "0 18px", display: "flex", alignItems: "baseline", gap: 14 }}>
                  <div style={{ fontSize: 24, fontWeight: 900, color: c.ink }}>Scene {scene.label}</div>
                  <div style={{ fontSize: 15, color: c.muted, fontWeight: 700 }}>{scene.note}</div>
                </div>
                <div style={{ fontSize: 15, color: c.orangeDark, fontWeight: 820, textAlign: "right", paddingRight: 20 }}>{scene.time}</div>
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

function AnalysisScene() {
  const frame = useCurrentFrame();
  const dimensions = [
    { icon: <VideoIcon size={20} />, title: "画面复刻", text: "主体 · 场景 · 道具" },
    { icon: <Film size={20} />, title: "镜头语言", text: "景别 · 机位 · 运动" },
    { icon: <Lightbulb size={20} />, title: "光线色彩", text: "光线 · 色彩 · 氛围" },
    { icon: <Sparkles size={20} />, title: "动作节奏", text: "动作 · 节奏 · 连续性" },
  ];
  return (
    <AbsoluteFill style={base}>
      <Background />
      <Headline start={0} eyebrow="STEP 3" title="多角度理解" subtitle="Visual · Camera · Light · Motion" style={{ position: "absolute", left: 66, top: 66, width: 520, zIndex: 2 }} />
      <div style={{ position: "absolute", left: 66, top: 236, width: 476, height: 268, borderRadius: 30, overflow: "hidden", boxShadow: "0 28px 86px rgba(88,58,46,0.18)", opacity: fade(frame, 20), translate: `0 ${rise(frame, 20, 34)}px` }}>
        <Img src={assets.still} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        <div style={{ position: "absolute", left: 18, top: 18, borderRadius: 999, background: "rgba(255,255,255,0.9)", padding: "9px 13px", color: c.orange, fontSize: 14, fontWeight: 850 }}>Scene 01</div>
      </div>
      <div style={{ position: "absolute", right: 66, top: 236, width: 560, display: "grid", gap: 14 }}>
        {dimensions.map((item, index) => (
          <div key={item.title} style={{ borderRadius: 24, border: `1px solid ${c.line}`, background: "rgba(255,253,248,0.92)", padding: 18, display: "grid", gridTemplateColumns: "44px 1fr", gap: 14, alignItems: "start", opacity: fade(frame, 30 + index * 14), translate: `${interpolate(frame, [30 + index * 14, 52 + index * 14], [50, 0], { ...clamp, easing: ease })}px 0`, boxShadow: "0 16px 54px rgba(88,58,46,0.09)" }}>
            <div style={{ width: 44, height: 44, borderRadius: 15, background: "rgba(217,119,87,0.12)", color: c.orange, display: "grid", placeItems: "center" }}>{item.icon}</div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 850, color: c.ink }}>{item.title}</div>
              <div style={{ marginTop: 6, fontSize: 16, lineHeight: 1.36, color: c.muted }}>{item.text}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", left: 570, bottom: 106, width: 180, height: 54, borderRadius: 999, background: c.ink, color: "white", display: "flex", alignItems: "center", justifyContent: "center", gap: 9, fontSize: 17, fontWeight: 850, opacity: fade(frame, 104), translate: `0 ${rise(frame, 104, 16)}px` }}><ScanLine size={18} /> Analyzed</div>
    </AbsoluteFill>
  );
}

function PromptScene() {
  const frame = useCurrentFrame();
  const promptText = "电影感广角镜头，红白汉服女性沿云海长廊缓步前行。黑色镜面地板反射白色立柱，暖金色天光，东方幻想史诗氛围。";
  const chars = Math.floor(interpolate(frame, [42, 116], [0, promptText.length], clamp));
  return (
    <AbsoluteFill style={base}>
      <Background />
      <Headline start={0} eyebrow="STEP 4" title="生成复刻 Prompt" subtitle="Ready to reuse" style={{ position: "absolute", left: 66, top: 70, width: 490, zIndex: 2 }} />
      <div style={{ position: "absolute", left: 66, top: 330, width: 430, height: 242, borderRadius: 26, overflow: "hidden", opacity: fade(frame, 18), boxShadow: "0 24px 70px rgba(88,58,46,0.16)" }}><Img src={assets.still} style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>
      <div style={{ position: "absolute", right: 66, top: 330, width: 588, minHeight: 430, borderRadius: 32, border: `1px solid ${c.line}`, background: "rgba(255,253,248,0.94)", padding: 30, boxShadow: "0 30px 100px rgba(88,58,46,0.14)", opacity: fade(frame, 24), translate: `0 ${rise(frame, 24, 32)}px` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 21, fontWeight: 860, color: c.ink }}>复刻 Prompt</div>
          <div style={{ borderRadius: 999, padding: "8px 12px", background: "rgba(47,155,115,0.12)", color: c.green, fontSize: 14, fontWeight: 840 }}>Ready</div>
        </div>
        <div style={{ marginTop: 22, fontSize: 30, lineHeight: 1.38, fontWeight: 650, color: c.ink }}>{promptText.slice(0, chars)}<span style={{ opacity: interpolate(frame % 20, [0, 10, 19], [1, 0.25, 1], clamp) }}>▌</span></div>
        <div style={{ position: "absolute", left: 30, right: 30, bottom: 28, display: "flex", gap: 12 }}>
          <button style={{ flex: 1, height: 56, borderRadius: 18, border: `1px solid ${c.line}`, background: "white", color: c.ink, fontSize: 18, fontWeight: 820, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}><Clipboard size={20} /> Copy Prompt</button>
          <button style={{ flex: 1, height: 56, borderRadius: 18, border: 0, background: c.orange, color: "white", fontSize: 18, fontWeight: 850, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, scale: interpolate(frame, [150, 158, 168], [1, 0.96, 1], { ...clamp, easing: ease }) }}><VideoIcon size={20} /> 做同款</button>
        </div>
      </div>
      <Cursor start={128} from={[900, 760]} to={[976, 704]} clickAt={154} />
    </AbsoluteFill>
  );
}

function GenerateScene() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={base}>
      <Background />
      <Headline start={0} eyebrow="STEP 5" title="点击做同款" subtitle="Use your own API key" style={{ position: "absolute", left: 66, top: 70, width: 500 }} />
      <div style={{ position: "absolute", left: 66, top: 214, width: 424, borderRadius: 28, border: `1px solid ${c.line}`, background: "rgba(255,253,248,0.92)", padding: 24, opacity: fade(frame, 22), translate: `0 ${rise(frame, 22, 28)}px`, boxShadow: "0 24px 72px rgba(88,58,46,0.12)" }}>
        <div style={{ fontSize: 18, color: c.orange, fontWeight: 850 }}>Prompt imported</div>
        <div style={{ marginTop: 12, height: 98, borderRadius: 20, background: "rgba(36,21,22,0.05)", padding: 16, color: c.muted, fontSize: 16, lineHeight: 1.35 }}>电影感广角镜头，红白汉服女性沿云海长廊前行...</div>
        <div style={{ marginTop: 16, display: "flex", gap: 10 }}><Pill text="16:9" /><Pill text="8s" /><Pill text="BYOK" active /></div>
      </div>
      <div style={{ position: "absolute", right: 66, top: 214, width: 582, height: 360, borderRadius: 30, overflow: "hidden", background: "#111", boxShadow: "0 34px 110px rgba(88,58,46,0.18)", opacity: fade(frame, 32), translate: `${interpolate(frame, [32, 58], [70, 0], { ...clamp, easing: ease })}px 0` }}>
        <Video src={assets.referenceVideo} muted volume={0} style={{ width: "100%", height: "100%", objectFit: "cover", scale: interpolate(frame, [32, 180], [1.1, 1.22], { ...clamp, easing: ease, output: "perceptual-scale" }) }} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0.36))" }} />
        <div style={{ position: "absolute", left: 28, right: 28, bottom: 28, borderRadius: 24, background: "rgba(255,255,255,0.9)", padding: 18, opacity: fade(frame, 74), display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div><div style={{ fontSize: 20, fontWeight: 860, color: c.ink }}>同款视频生成中</div><div style={{ marginTop: 5, fontSize: 14, color: c.muted }}>using your KIE API key</div></div>
          <div style={{ width: 46, height: 46, borderRadius: 999, background: c.orange, display: "grid", placeItems: "center", color: "white" }}><WandSparkles size={23} /></div>
        </div>
      </div>
    </AbsoluteFill>
  );
}

function CloseScene() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ ...base, background: "#fffdf8", display: "grid", placeItems: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 22, opacity: fade(frame, 4), translate: `0 ${rise(frame, 4, 22)}px`, scale: scaleIn(frame, 4, 0.94) }}>
        <Img src={assets.logo} style={{ width: 92, height: 96, objectFit: "contain" }} />
        <div style={{ fontSize: 54, lineHeight: 1, color: c.ink, fontWeight: 900 }}>Prompt Lens</div>
      </div>
    </AbsoluteFill>
  );
}

export function PromptLensCoreWorkflowDemo() {
  return (
    <AbsoluteFill style={base}>
      <Sequence from={0} durationInFrames={150}><UploadScene /></Sequence>
      <Sequence from={150} durationInFrames={136}><SplittingScene /></Sequence>
      <Sequence from={286} durationInFrames={144}><AnalysisScene /></Sequence>
      <Sequence from={430} durationInFrames={174}><PromptScene /></Sequence>
      <Sequence from={604} durationInFrames={144}><GenerateScene /></Sequence>
      <Sequence from={748} durationInFrames={152}><CloseScene /></Sequence>
    </AbsoluteFill>
  );
}

function Pill({ text, active = false }: { text: string; active?: boolean }) {
  return <div style={{ borderRadius: 999, padding: "8px 12px", background: active ? "rgba(217,119,87,0.13)" : "rgba(36,21,22,0.06)", color: active ? c.orangeDark : c.muted, fontSize: 14, fontWeight: 820 }}>{text}</div>;
}

const brandStyle: CSSProperties = {
  position: "absolute",
  left: 66,
  top: 56,
  display: "flex",
  alignItems: "center",
  gap: 12,
  color: c.ink,
  fontSize: 22,
  fontWeight: 860,
};

const base: CSSProperties = {
  fontFamily: `${dmSans}, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", ui-sans-serif, system-ui, sans-serif`,
  background: c.bg,
  color: c.ink,
  overflow: "hidden",
};








