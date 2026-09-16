import type { CSSProperties } from "react";
import { AbsoluteFill, Img, OffthreadVideo, Sequence, Loop, interpolate, staticFile, useCurrentFrame } from "remotion";
import { ArrowRight, Check, ChevronLeft, ChevronRight, Copy, MousePointer2, Sparkles, WandSparkles, VideoIcon } from "lucide-react";

const bg = "#F7F2EA";
const ink = "#302b29";
const accent = "#D97757";
const ease = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const mix = (f: number, times: number[], values: number[]) => interpolate(f, times, values, { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
const original = "Cinematic wide shot. A woman in flowing red-and-white hanfu walks away from the camera along a monumental curved corridor. Golden dragon reliefs decorate deep-red walls; lotus-carved railings overlook an endless sea of clouds. Polished black floors reflect the columns. Warm dawn light, epic depth, smooth camera movement.";
const rewritten = "Cinematic wide shot. A man in a tailored black suit and white shirt walks away from the camera along a monumental curved corridor. Golden dragon reliefs decorate deep-red walls; lotus-carved railings overlook an endless sea of clouds. Polished black floors reflect the columns and his silhouette. Warm dawn light, epic depth, smooth camera movement.";
const instruction = "Replace the woman in hanfu\nwith a man in a black suit.";
const surface: CSSProperties = { background: "#fffefa", border: "1px solid #e6dfd5", borderRadius: 8, boxShadow: "0 24px 60px -28px #57453655", boxSizing: "border-box" };

function Cursor({ f, start, click, x, y }: { f: number; start: number; click: number; x: number; y: number }) {
  const opacity = mix(f, [start, start + 8, click + 6, click + 18], [0, 1, 1, 0]);
  return <div style={{ position: "absolute", left: x + mix(f, [start, click - 5], [80, 0]), top: y + mix(f, [start, click - 5], [65, 0]), opacity, zIndex: 10 }}>
    <div style={{ position: "absolute", width: 34, height: 34, left: -17, top: -17, borderRadius: "50%", border: `2px solid ${accent}`, opacity: mix(f, [click, click + 2, click + 20], [0, .8, 0]), transform: `scale(${mix(f, [click, click + 20], [.4, 2])})` }} />
    <MousePointer2 size={27} fill="white" stroke={ink} style={{ transform: `scale(${mix(f, [click - 3, click, click + 8], [1, .8, 1])})` }} />
  </div>;
}

export function PromptLensRewriteDemo() {
  const frame = useCurrentFrame();
  const f = frame * 1.2;
  const changed = f >= 335 && (f < 448 || f >= 515);
  const ready = f >= 335;
  const generating = f >= 688;
  const close = mix(frame, [590, 638], [0, 1]);
  const outro = mix(frame, [987, 1028], [0, 1]);
  const times = [0, 50, 76, 135, 263, 326, 365, 410, 540, 593, 642, 706, 757, 832];
  const zoom = mix(f, times, [.85, 1, 1, 2.45, 2.45, 1.1, 1.1, 3.1, 3.1, 1, 3.0, 3.0, 1.12, 1.12]);
  const cx = mix(f, times, [600, 600, 600, 883, 883, 600, 600, 877, 877, 600, 944, 944, 600, 600]);
  const cy = mix(f, times, [475, 475, 475, 545, 545, 475, 475, 697, 697, 475, 199, 199, 475, 475]);
  const typed = instruction.slice(0, Math.floor(mix(f, [150, 235], [0, instruction.length])));
  return <AbsoluteFill style={{ background: bg, color: ink, fontFamily: "Arial, sans-serif", letterSpacing: 0, overflow: "hidden" }}>
    <div style={{ position: "absolute", left: 44, top: 36, display: "flex", gap: 10, alignItems: "center", opacity: 1 - outro }}><Img src={staticFile("prompt-lens-icon.png")} style={{ width: 30, height: 32, objectFit: "contain" }} /><span style={{ fontSize: 18 }}>Prompt Lens</span></div>
    <div style={{ position: "absolute", width: 1200, height: 950, transformOrigin: "0 0", opacity: 1 - close, transform: `translate(600px,475px) scale(${zoom * (1 - close * .15)}) translate(${-cx}px,${-cy}px)`, filter: `blur(${close * 8}px)` }}>
      <div style={{ position: "absolute", left: 160, top: 100, fontSize: 38, fontWeight: 600, opacity: mix(f, [65, 110], [1, 0]) }}>Make it yours.</div>
      <div style={{ ...surface, position: "absolute", left: 150, top: 165, width: 900, height: 640, opacity: mix(f, [0, 35], [0, 1]), transform: `translateY(${mix(f, [0, 50], [55, 0])}px)` }}>
        <div style={{ position: "absolute", left: 25, top: 20, display: "flex", alignItems: "center", gap: 12, fontSize: 18 }}><VideoIcon size={19} /><span>01</span><span style={{ color: "#8d8982", fontSize: 14 }}>0:00 – 0:02.2</span></div>
        <div style={{ position: "absolute", right: 24, top: 13, height: 42, padding: "0 17px", borderRadius: 6, background: f >= 600 ? accent : "#f0e8df", color: f >= 600 ? "white" : ink, display: "flex", gap: 9, alignItems: "center", fontSize: 16 }}><VideoIcon size={18} />Create<ArrowRight size={17} /></div>
        <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", top: 72, width: 387, height: 174, overflow: "hidden", borderRadius: 8, boxShadow: "0 10px 24px -12px #57453666" }}><Loop durationInFrames={132}><OffthreadVideo src={staticFile("remotion/remix-flow/rewrite-before.mp4")} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} /></Loop></div>
        <div style={{ position: "absolute", left: 26, top: 268, fontSize: 16, fontWeight: 600 }}>Prompt</div>
        <div style={{ position: "absolute", left: 564, top: 268, fontSize: 16, fontWeight: 600, display: "flex", gap: 8 }}><Sparkles size={18} color={accent} />AI rewrite</div>
        <div style={{ position: "absolute", left: 26, top: 299, width: 515, height: 200, border: `1px solid ${changed ? "#adc8bc" : "#dfd9d1"}`, borderRadius: 6, overflow: "hidden", background: changed ? "#f4faf6" : "white", padding: 18, boxSizing: "border-box" }}>
          <div style={{ fontSize: 18, lineHeight: 1.65, color: "#59544f", transform: `translateY(${f >= 300 && f < 335 ? mix(f, [300, 335], [0, -12]) : 0}px)`, opacity: f >= 300 && f < 335 ? mix(f, [300, 335], [1, .15]) : 1 }}>{changed ? rewritten : original}</div>
          <div style={{ position: "absolute", inset: 0, background: "#e1eee5", transformOrigin: "right", transform: `scaleX(${mix(f, [330, 336, 370], [0, 1, 0])})` }} />
        </div>
        <div style={{ position: "absolute", left: 564, top: 299, width: 310, height: 200, padding: 18, border: `1.5px solid ${f >= 130 && f < 335 ? accent : "#dfd9d1"}`, borderRadius: 6, boxSizing: "border-box", background: "white", boxShadow: f >= 130 && f < 335 ? "0 0 0 4px #d9775710" : "none" }}>
          <div style={{ fontSize: 20, lineHeight: 1.6, whiteSpace: "pre-line", color: typed ? ink : "#aaa49c" }}>{typed || "Your idea…"}{f >= 150 && f < 245 && <span style={{ opacity: Math.floor(f / 15) % 2 }}>▏</span>}</div>
          <div style={{ position: "absolute", bottom: 13, right: 13, width: 38, height: 38, borderRadius: "50%", background: accent, color: "white", display: "grid", placeItems: "center", transform: `scale(${mix(f, [267, 272, 281], [1, .85, 1])})` }}>{f >= 272 && f < 335 ? <Sparkles size={18} style={{ transform: `rotate(${(f - 272) * 4}deg)` }} /> : ready ? <Check size={18} /> : <WandSparkles size={18} />}</div>
        </div>
        <div style={{ position: "absolute", left: 26, top: 523, fontSize: 16, color: "#82776c" }}>Scene details</div>
        <div style={{ position: "absolute", right: 24, top: 511, display: "flex", gap: 17, alignItems: "center", height: 42, color: "#8a7367" }}><Copy size={18} /><ChevronLeft size={25} style={{ opacity: changed ? 1 : .3 }} /><span style={{ fontSize: 19, fontVariantNumeric: "tabular-nums", width: 59, textAlign: "center" }}>{changed ? 2 : 1} / {ready ? 2 : 1}</span><ChevronRight size={25} style={{ opacity: changed || !ready ? .3 : 1 }} /></div>
        <div style={{ position: "absolute", left: 26, right: 26, top: 564, display: "flex", gap: 14 }}>{[.95, .7, .83].map((w, i) => <div key={i} style={{ height: 8, width: `${w * 30}%`, background: changed ? "#c8dfd2" : "#e7e1d9", borderRadius: 3 }} />)}</div>
      </div>
      <Cursor f={f} start={240} click={272} x={996} y={639} />
      <Cursor f={f} start={415} click={448} x={891} y={695} />
      <Cursor f={f} start={480} click={515} x={1012} y={695} />
      <Cursor f={f} start={650} click={688} x={965} y={202} />
      <div style={{ ...surface, position: "absolute", left: 200, top: 265, width: 800, height: 440, opacity: mix(f, [712, 748], [0, 1]), transform: `translateY(${mix(f, [712, 755], [70, 0])}px) scale(${mix(f, [712, 755], [.9, 1])})`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24, pointerEvents: "none", visibility: generating ? "visible" : "hidden" }}>
        <Sparkles size={46} color={accent} style={{ transform: `rotate(${mix(f, [720, 832], [-30, 25])}deg)` }} /><div style={{ fontSize: 29 }}>Creating your video</div><div style={{ width: 280, height: 5, background: "#eee7dd", borderRadius: 3 }}><div style={{ height: "100%", width: `${mix(f, [740, 840], [3, 80])}%`, background: accent, borderRadius: 3 }} /></div><div style={{ fontSize: 16, color: "#998b7d" }}>02 <ArrowRight size={14} style={{ verticalAlign: "middle", margin: "0 10px" }} /><VideoIcon size={19} style={{ verticalAlign: "middle" }} /></div>
      </div>
    </div>
    <Sequence from={602} durationInFrames={430}>
      <RewriteComparison />
    </Sequence>
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 23, opacity: outro, transform: `scale(${mix(frame, [987, 1040], [.82, 1])})` }}><Img src={staticFile("prompt-lens-icon.png")} style={{ width: 108, height: 115, objectFit: "contain" }} /><div style={{ fontSize: 46, fontWeight: 600 }}>Prompt Lens</div></AbsoluteFill>
  </AbsoluteFill>;
}

function RewriteComparison() {
  const f = useCurrentFrame();
  const enter = mix(f, [0, 36], [0, 1]);
  const exit = mix(f, [385, 426], [0, 1]);
  const reveal = mix(f, [80, 130], [0, 1]);
  const camera = mix(f, [0, 35, 75, 132, 365, 420], [1.04, 1.04, 1.04, 1, 1.025, .92]);
  return <AbsoluteFill style={{ opacity: enter * (1 - exit), transform: `translateY(${(1 - enter) * 70}px) scale(${camera})`, transformOrigin: "600px 300px", background: bg }}>
    <div style={{ position: "absolute", top: 93, width: "100%", textAlign: "center", fontSize: 42, fontWeight: 600 }}>Your idea. A new scene.</div>
    {[false, true].map((after, i) => (
      <div key={i} style={{ position: "absolute", left: 48 + i * 568, top: 185, width: 536, transform: `translateX(${mix(f, [0, 48], [after ? 90 : -90, 0])}px)` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 17, color: after ? "#36775d" : "#8a7367", marginBottom: 15 }}>
          <span style={{ fontWeight: 600 }}>{after ? "AFTER" : "BEFORE"}</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{after ? "2 / 2" : "1 / 2"}</span>
        </div>
        <div style={{ ...surface, height: 184, padding: "22px 24px", borderColor: after ? "#9cbdab" : "#e6dfd5", boxShadow: "none" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, color: "#857c73", marginBottom: 12 }}>{after ? <Sparkles size={17} color="#36775d" /> : <Copy size={17} />}Prompt</div>
          <div style={{ fontSize: 25, lineHeight: 1.45 }}>
            <span style={{ background: after ? "#d9ebdf" : "#f1dfd5", boxDecorationBreak: "clone", padding: "3px 5px", borderRadius: 3 }}>
              {after ? "A man in a tailored black suit" : "A woman in red-and-white hanfu"}
            </span>
            <span style={{ fontSize: 18, color: "#79716a" }}> walks along a curved corridor above the clouds.</span>
          </div>
        </div>
        <div style={{ height: 36, display: "flex", justifyContent: "center", alignItems: "center", opacity: reveal }}><ArrowRight size={22} color={after ? "#36775d" : "#a58a79"} style={{ transform: "rotate(90deg)" }} /></div>
        <div style={{ ...surface, overflow: "hidden", height: 302, background: "#171715", borderColor: after ? "#9cbdab" : "#e6dfd5", opacity: reveal, transform: `translateY(${(1 - reveal) * 65}px) scale(${.94 + reveal * .06})`, boxShadow: "0 20px 40px -24px #57453660" }}>
          <Sequence from={90} layout="none">
            <Loop durationInFrames={after ? 240 : 132}>
              <OffthreadVideo src={staticFile(`remotion/remix-flow/rewrite-${after ? "after" : "before"}.mp4`)} muted style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center" }} />
            </Loop>
          </Sequence>
        </div>
        <div style={{ marginTop: 14, fontSize: 15, color: "#8c8177", opacity: reveal }}>{after ? "AI generated" : "Original"}<span style={{ float: "right", fontVariantNumeric: "tabular-nums" }}>{after ? "4.0s" : "2.2s"}</span></div>
      </div>
    ))}
    <div style={{ position: "absolute", left: 583, top: 290, opacity: mix(f, [20, 48], [0, 1]), color: accent }}><ArrowRight size={34} /></div>
  </AbsoluteFill>;
}
