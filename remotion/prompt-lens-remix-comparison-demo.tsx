import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Easing, Img, Sequence, Video, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { ArrowRight, Check, ChevronDown, Copy, MousePointer2, Sparkles, VideoIcon } from "lucide-react";

const clamp = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
// Zero velocity and acceleration at each camera stop prevent a sharp start or brake.
const travel = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const settle = Easing.bezier(0.16, 1, 0.3, 1);
const ink = "#24262c";
const accent = "#d97757";
const prompt = "电影级广角镜头，低角度仰拍。一名身穿深色古装的古代剑客背对镜头，站在布满枯枝的荒凉大地上。天空中盘旋着一条巨大的、由半透明云雾构成的东方龙，龙身巨大，遮天蔽日。周围有无数细小的黑色碎片或鱼群在空中漂浮。冷色调，阴沉昏暗的氛围，史诗感，高细节，电影质感，光线晦暗，强调龙的宏大轮廓。";
const before = staticFile("remotion/remix-flow/before.mp4");
const after = staticFile("remotion/remix-flow/after.mp4");
const resultPlaybackFrame = 209;

// Monotone Hermite tangents carry velocity through waypoints without overshooting a target.
function cameraValue(f: number, times: number[], values: number[]) {
  const slopes = times.slice(1).map((time, i) => (values[i + 1] - values[i]) / (time - times[i]));
  const tangents = values.map((_, i) => {
    if (i === 0 || i === values.length - 1 || slopes[i - 1] * slopes[i] <= 0) return 0;
    const left = times[i] - times[i - 1];
    const right = times[i + 1] - times[i];
    return 3 * (left + right) / ((2 * right + left) / slopes[i - 1] + (right + 2 * left) / slopes[i]);
  });
  if (f <= times[0]) return values[0];
  if (f >= times[times.length - 1]) return values[values.length - 1];
  const i = times.findIndex(time => time > f) - 1;
  const span = times[i + 1] - times[i];
  const t = (f - times[i]) / span;
  return (2 * t ** 3 - 3 * t ** 2 + 1) * values[i] + (t ** 3 - 2 * t ** 2 + t) * span * tangents[i]
    + (-2 * t ** 3 + 3 * t ** 2) * values[i + 1] + (t ** 3 - t ** 2) * span * tangents[i + 1];
}
function cameraPose(f: number, times: number[], poses: Pose[]): Pose {
  return {
    x: cameraValue(f, times, poses.map(p => p.x)),
    y: cameraValue(f, times, poses.map(p => p.y)),
    scale: Math.exp(cameraValue(f, times, poses.map(p => Math.log(p.scale)))),
    rotate: cameraValue(f, times, poses.map(p => p.rotate)),
  };
}

function tween(f: number, frames: number[], values: number[], easing = travel) {
  return interpolate(f, frames, values, { ...clamp, easing });
}
function enter(f: number, start: number, end = start + 18) {
  return tween(f, [start, end], [0, 1], settle);
}
type Pose = { x: number; y: number; scale: number; rotate: number };
function pose(f: number, frames: number[], poses: Pose[]): Pose {
  return {
    x: tween(f, frames, poses.map(p => p.x)), y: tween(f, frames, poses.map(p => p.y)),
    scale: Math.exp(tween(f, frames, poses.map(p => Math.log(p.scale)))), rotate: tween(f, frames, poses.map(p => p.rotate)),
  };
}
function Floating({ at, width, children, opacity = 1, blur = 0, z = 1 }: {
  at: Pose; width: number; children: ReactNode; opacity?: number; blur?: number; z?: number;
}) {
  return <div style={{ position: "absolute", left: at.x, top: at.y, width, opacity, zIndex: z,
    transform: `translate(-50%, -50%) rotate(${at.rotate}deg) scale(${at.scale})`,
    filter: `blur(${blur}px)`, transformOrigin: "50% 50%" }}>{children}</div>;
}
function Pointer({ f, start, click, from, to }: { f: number; start: number; click: number; from: [number, number]; to: [number, number] }) {
  const x = tween(f, [start, click - 3], [from[0], to[0]], settle);
  const y = tween(f, [start, click - 3], [from[1], to[1]], settle);
  const opacity = enter(f, start, start + 6) * (1 - enter(f, click + 9, click + 17));
  return <div style={{ position: "absolute", left: x, top: y, opacity, zIndex: 20,
    transform: `scale(${tween(f, [click - 2, click + 2, click + 9], [1, .84, 1], settle)})` }}>
    <MousePointer2 size={32} fill="white" stroke={ink} strokeWidth={1.6} style={{ filter: "drop-shadow(0 3px 3px #0003)" }} />
    <div style={{ position: "absolute", left: -15, top: -15, width: 36, height: 36, border: `2px solid ${accent}`, borderRadius: "50%",
      opacity: tween(f, [click, click + 2, click + 15], [0, .65, 0]),
      transform: `scale(${tween(f, [click, click + 15], [.5, 1.8])})` }} />
  </div>;
}
function PromptPanel({ f }: { f: number }) {
  return <div style={{ ...surface, position: "relative", height: 446, padding: 30 }}>
    <div style={{ height: 50, display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #ececf0", paddingBottom: 18 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 23, fontWeight: 650 }}>
        <Sparkles size={23} color={accent} /><span>{f < 101 ? "复刻提示" : "创建视频"}</span>
      </div>
      <span style={{ color: "#8a8d96", fontSize: 14 }}>{f < 101 ? "场景01" : "文字转视频"}</span>
    </div>
    <div style={{ paddingTop: 23, fontSize: 21, lineHeight: 1.85, color: "#454851", height: 247, overflow: "hidden" }}>{prompt}</div>
    <div style={{ position: "absolute", bottom: 29, left: 30, right: 30, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", gap: 18, color: "#787b84", fontSize: 14 }}>
        {f < 101 ? <Copy size={19} /> : <><span>自动-平衡 <ChevronDown size={13} /></span><span>16:9 · 720P · 2秒</span></>}
      </div>
      <div style={{ ...button, transform: `scale(${tween(f, [75, 79, 86, 145, 149, 156], [1, .95, 1, 1, .95, 1], settle)})` }}>
        <VideoIcon size={19} />{f < 101 ? "做同款" : "生成视频"}<ArrowRight size={17} />
      </div>
    </div>
    <Pointer f={f} start={49} click={78} from={[755, 480]} to={[601, 390]} />
    <Pointer f={f} start={126} click={148} from={[750, 485]} to={[601, 390]} />
  </div>;
}
function VideoPanel({ src, label, generated = false, f }: { src: string; label: string; generated?: boolean; f: number }) {
  const { fps } = useVideoConfig();
  const playbackStart = Math.round(resultPlaybackFrame * fps / 30);
  const reveal = enter(f, 179, 195);
  return <div style={{ ...surface, overflow: "hidden" }}>
    <div style={{ padding: "20px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 21, fontWeight: 650 }}>
        <VideoIcon size={20} color={generated ? accent : "#8a8d96"} />{label}
      </div>
      <span style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, color: generated ? "#2d8c70" : "#878b94" }}>
        {generated && f >= 190 ? <><Check size={15} />生成完成</> : generated ? "生成状态" : "场景01"}
      </span>
    </div>
    <div style={{ position: "relative", aspectRatio: "20 / 9", background: generated ? "#f4f5f7" : "#101419", overflow: "hidden" }}>
      {generated && <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 18, opacity: 1 - reveal }}>
        <Sparkles size={30} color={accent} style={{ transform: `rotate(${Math.max(0, f - 150) * 2}deg)` }} />
        <span style={{ fontSize: 16, color: "#7c808a" }}>{f < 150 ? "生成状态" : "正在生成视频"}</span>
        <div style={{ width: 190, height: 4, background: "#e1e4ea", overflow: "hidden", borderRadius: 2, opacity: enter(f, 150, 157) }}>
          <div style={{ height: "100%", background: accent, transformOrigin: "left", transform: `scaleX(${tween(f, [153, 187], [.08, 1])})` }} />
        </div>
      </div>}
      <div style={{ position: "absolute", inset: 0, opacity: generated ? reveal : 1,
        transform: `scale(${generated ? tween(f, [179, 200], [1.06, 1], settle) : 1})` }}>
        {generated ? <Sequence from={playbackStart} layout="none"><Video src={src} muted loop style={videoStyle} /></Sequence>
          : f < 179 ? <Video src={src} muted loop style={videoStyle} />
            : <Sequence from={playbackStart} layout="none"><Video src={src} muted loop style={videoStyle} /></Sequence>}
      </div>
    </div>
    <div style={{ height: 36, display: "flex", alignItems: "center", padding: "0 24px", fontSize: 12, color: "#9a9da5" }}>{generated ? "变体 1" : "原视频"}</div>
  </div>;
}

// One shared camera preserves the prompt card's continuity between product states.
export function PromptLensRemixComparisonDemo() {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame() * 30 / fps;
  // Give the second button approach an extra second while keeping click and card states in sync.
  const sceneTime = (at: number) => interpolate(at, [0, 118, 178, 420], [0, 118, 148, 390], clamp);
  const f = sceneTime(frame);
  const cameraFrames = [0, 25, 43, 69, 87, 118, 143, 157, 204, 246, 313, 329];
  const cameraPoses: Pose[] = [
    { x: 580, y: 445, scale: .83, rotate: 0 }, { x: 600, y: 460, scale: 1, rotate: 0 },
    { x: 600, y: 460, scale: 1, rotate: 0 }, { x: 902, y: 626, scale: 2.65, rotate: 0 },
    { x: 902, y: 626, scale: 2.65, rotate: 0 }, { x: 550, y: 465, scale: .97, rotate: 0 },
    { x: 584, y: 599, scale: 3.2, rotate: 2 },
    { x: 584, y: 599, scale: 3.2, rotate: 2 }, { x: 850, y: 452, scale: 1.55, rotate: 0 },
    { x: 600, y: 470, scale: .96, rotate: 0 },
    { x: 600, y: 470, scale: 1.015, rotate: 0 }, { x: 600, y: 470, scale: 1.015, rotate: 0 },
  ];
  const cam = cameraPose(f, cameraFrames, cameraPoses);
  const close = tween(f, [313, 342], [0, 1]);
  const prev = cameraPose(sceneTime(Math.max(0, frame - 30 / fps)), cameraFrames, cameraPoses);
  const motionBlur = Math.min(1.5, (Math.hypot(cam.x - prev.x, cam.y - prev.y) + Math.abs(Math.log(cam.scale / prev.scale)) * 400) * .045);
  const promptPose = pose(f, [0, 25, 91, 120, 180, 225], [
    { x: 665, y: 535, scale: .93, rotate: 3 }, { x: 650, y: 455, scale: 1, rotate: 0 },
    { x: 650, y: 455, scale: 1, rotate: 0 }, { x: 370, y: 465, scale: .82, rotate: -2 },
    { x: 370, y: 465, scale: .82, rotate: -2 }, { x: 255, y: -160, scale: .68, rotate: -5 },
  ]);
  const originalPose = pose(f, [0, 25, 91, 120, 205, 241, 329], [
    { x: 210, y: 430, scale: .67, rotate: -7 }, { x: 175, y: 420, scale: .7, rotate: -5 },
    { x: 175, y: 420, scale: .7, rotate: -5 }, { x: 80, y: 330, scale: .54, rotate: -8 },
    { x: 80, y: 330, scale: .54, rotate: -8 }, { x: 305, y: 470, scale: 1, rotate: 0 },
    { x: 305, y: 470, scale: 1, rotate: 0 },
  ]);
  const resultPose = pose(f, [111, 140, 175, 202, 241], [
    { x: 1040, y: 590, scale: .7, rotate: 6 }, { x: 880, y: 440, scale: .82, rotate: 2 },
    { x: 880, y: 440, scale: .82, rotate: 2 }, { x: 850, y: 452, scale: 1, rotate: 0 },
    { x: 895, y: 470, scale: 1, rotate: 0 },
  ]);
  return <AbsoluteFill style={{ background: "#F7F2EA", color: ink, overflow: "hidden", fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif', letterSpacing: 0 }}>
    <div style={{ position: "absolute", left: 48, top: 38, display: "flex", alignItems: "center", gap: 10, opacity: .8 * (1 - close) }}>
      <Img src={staticFile("prompt-lens-icon.png")} style={{ width: 28, height: 28, objectFit: "contain" }} />
      <span style={{ fontSize: 17, fontWeight: 650 }}>Prompt Lens</span>
    </div>
    <div style={{ position: "absolute", left: 0, top: 0, width: 1200, height: 950, transformOrigin: "0 0",
      opacity: 1 - close,
      transform: `translate(600px, ${475 - close * 35}px) scale(${cam.scale * (1 - close * .24)}) rotate(${cam.rotate}deg) translate(${-cam.x}px, ${-cam.y}px)`, filter: `blur(${motionBlur + close * 10}px)` }}>
      <div style={{ position: "absolute", left: 260, top: 140, width: 680, textAlign: "center", opacity: 1 - enter(f, 39, 51), transform: `translateY(${tween(f, [0, 25], [24, 0], settle)}px)` }}>
        <div style={{ fontSize: 40, fontWeight: 700 }}>看到喜欢的，一键做同款</div>
        <div style={{ fontSize: 17, color: "#7c8491", marginTop: 14 }}>从可复刻提示词开始</div>
      </div>
      <Floating at={originalPose} width={550} opacity={tween(f, [0, 20, 91, 120, 205, 238], [0, 1, 1, .26, .26, 1])} blur={tween(f, [91, 120, 205, 238], [0, 2, 2, 0])}>
        <VideoPanel src={before} label="原视频" f={f} />
      </Floating>
      <Floating at={promptPose} width={720} opacity={enter(f, 0, 20) * (1 - enter(f, 199, 227))} z={3}>
        <PromptPanel f={f} />
      </Floating>
      <Floating at={resultPose} width={550} opacity={enter(f, 115, 142)} z={4}>
        <VideoPanel src={after} label="生成后" f={f} generated />
      </Floating>
      <div style={{ position: "absolute", top: 199, left: 200, width: 800, textAlign: "center", opacity: enter(f, 225, 251), transform: `translateY(${tween(f, [225, 251], [20, 0], settle)}px)`, fontSize: 52, fontWeight: 750 }}><span style={{ color: accent }}>1:1</span> 还原原视频</div>
      <div style={{ position: "absolute", top: 707, left: 300, width: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 12, opacity: enter(f, 246, 267), fontSize: 21, color: "#707987" }}><Sparkles size={21} color={accent} />复刻构图、光影与镜头氛围</div>
    </div>
    <AbsoluteFill style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 23,
      opacity: enter(f, 332, 355), filter: `blur(${tween(f, [332, 355], [6, 0], settle)}px)`,
      transform: `translateY(${tween(f, [332, 360], [25, 0], settle)}px) scale(${tween(f, [332, 360, 389], [.86, 1, 1.015], settle)})` }}>
      <Img src={staticFile("prompt-lens-icon.png")} style={{ width: 116, height: 122, objectFit: "contain" }} />
      <div style={{ fontSize: 52, lineHeight: 1.1, fontWeight: 750 }}>Prompt Lens</div>
      <div style={{ fontSize: 19, color: "#7c8491", opacity: enter(f, 351, 369) }}>让灵感，成为你的同款</div>
    </AbsoluteFill>
  </AbsoluteFill>;
}

const surface: CSSProperties = { boxSizing: "border-box", background: "#fff", border: "1px solid rgba(111,124,143,.16)", borderRadius: 8, boxShadow: "0 28px 58px -22px rgba(42,58,83,.26), 0 3px 7px rgba(42,58,83,.06)" };
const button: CSSProperties = { height: 46, padding: "0 19px", display: "flex", alignItems: "center", gap: 9, background: accent, color: "white", borderRadius: 7, fontSize: 17, fontWeight: 600 };
const videoStyle: CSSProperties = { width: "100%", height: "100%", objectFit: "contain", background: "#101419" };
