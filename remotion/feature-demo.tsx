import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/google-fonts/Outfit";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "500", "600", "700", "800"],
  subsets: ["latin"],
});

type DemoKind = "analyze" | "generate" | "audio" | "edit";

type DemoConfig = {
  id: string;
  kind: DemoKind;
  title: string;
  label: string;
  accent: string;
  secondary: string;
  output: string;
};

export const featureDemos: DemoConfig[] = [
  {
    id: "FeatureVideoAnalysis",
    kind: "analyze",
    title: "Video Analysis",
    label: "Extract prompts from any AI video",
    accent: "#D97757",
    secondary: "#6A9BCC",
    output: "Structured prompt",
  },
  {
    id: "FeatureVideoGeneration",
    kind: "generate",
    title: "Video Generation",
    label: "Prompt to cinematic clip",
    accent: "#7C8F5D",
    secondary: "#D97757",
    output: "Preview ready",
  },
  {
    id: "FeatureAudioRecognition",
    kind: "audio",
    title: "Audio Analysis",
    label: "Decode speech and rhythm",
    accent: "#6A9BCC",
    secondary: "#D97757",
    output: "Timed segments",
  },
  {
    id: "FeatureVideoEdit",
    kind: "edit",
    title: "Video Editing",
    label: "Prompt-driven timeline edits",
    accent: "#8A6FB0",
    secondary: "#D97757",
    output: "Final cut",
  },
];

const clamp = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
const ease = Easing.bezier(0.16, 1, 0.3, 1);

const Card: React.FC<React.PropsWithChildren<{ style?: React.CSSProperties }>> = ({ children, style }) => (
  <div
    style={{
      background: "rgba(255,255,255,0.82)",
      border: "1px solid rgba(20,20,19,0.1)",
      borderRadius: 22,
      boxShadow: "0 22px 55px rgba(20,20,19,0.12)",
      backdropFilter: "blur(10px)",
      ...style,
    }}
  >
    {children}
  </div>
);

const Header: React.FC<{ demo: DemoConfig }> = ({ demo }) => {
  const frame = useCurrentFrame();

  return (
    <div
      style={{
        position: "absolute",
        left: 54,
        top: 44,
        opacity: interpolate(frame, [0, 24], [0, 1], { ...clamp, easing: ease }),
        translate: `0 ${interpolate(frame, [0, 24], [16, 0], { ...clamp, easing: ease })}px`,
      }}
    >
      <div style={{ color: demo.accent, fontSize: 18, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase" }}>
        Prompt Lens
      </div>
      <div style={{ color: "#141413", fontSize: 48, fontWeight: 800 }}>{demo.title}</div>
      <div style={{ color: "#6B6860", fontSize: 24, fontWeight: 500 }}>{demo.label}</div>
    </div>
  );
};

const PromptPanel: React.FC<{ demo: DemoConfig }> = ({ demo }) => {
  const frame = useCurrentFrame();
  const scan = interpolate(frame % 90, [0, 89], [0, 1], clamp);

  return (
    <Card
      style={{
        position: "absolute",
        left: 54,
        bottom: 48,
        width: 402,
        height: 214,
        padding: 24,
        opacity: interpolate(frame, [18, 42], [0, 1], { ...clamp, easing: ease }),
        translate: `${interpolate(frame, [18, 42], [-28, 0], { ...clamp, easing: ease })}px 0`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 12, height: 12, borderRadius: 999, background: demo.accent }} />
        <div style={{ color: "#141413", fontSize: 20, fontWeight: 700 }}>Input prompt</div>
      </div>
      <div style={{ marginTop: 22, display: "grid", gap: 12 }}>
        {[0, 1, 2].map((row) => (
          <div
            key={row}
            style={{
              height: 15,
              width: `${92 - row * 15}%`,
              borderRadius: 999,
              background: `linear-gradient(90deg, rgba(20,20,19,0.1), ${demo.accent}33, rgba(20,20,19,0.08))`,
              opacity: interpolate(frame, [28 + row * 8, 44 + row * 8], [0, 1], { ...clamp, easing: ease }),
            }}
          />
        ))}
      </div>
      <div style={{ position: "absolute", left: 24, right: 24, bottom: 24, height: 42, borderRadius: 14, background: "#141413", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(90deg, transparent, ${demo.accent}88, transparent)`, translate: `${-130 + scan * 330}px 0` }} />
        <div style={{ position: "relative", color: "#F5F3EC", fontSize: 18, fontWeight: 700, textAlign: "center", lineHeight: "42px" }}>
          Analyze
        </div>
      </div>
    </Card>
  );
};

const OutputPanel: React.FC<{ demo: DemoConfig }> = ({ demo }) => {
  const frame = useCurrentFrame();
  const fill = interpolate(frame, [48, 118], [8, 94], clamp);

  return (
    <Card
      style={{
        position: "absolute",
        right: 54,
        bottom: 48,
        width: 384,
        height: 214,
        padding: 24,
        opacity: interpolate(frame, [38, 62], [0, 1], { ...clamp, easing: ease }),
        translate: `${interpolate(frame, [38, 62], [28, 0], { ...clamp, easing: ease })}px 0`,
      }}
    >
      <div style={{ color: "#141413", fontSize: 20, fontWeight: 800 }}>{demo.output}</div>
      <div style={{ marginTop: 18, display: "grid", gap: 11 }}>
        {["Subject", "Camera", "Lighting", "Motion"].map((label, index) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 74, color: "#6B6860", fontSize: 15, fontWeight: 600 }}>{label}</div>
            <div style={{ flex: 1, height: 10, borderRadius: 999, background: "rgba(20,20,19,0.08)", overflow: "hidden" }}>
              <div style={{ width: `${Math.max(0, fill - index * 10)}%`, height: "100%", borderRadius: 999, background: index % 2 === 0 ? demo.accent : demo.secondary }} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
};

const AnalyzeScene: React.FC<{ demo: DemoConfig }> = ({ demo }) => {
  const frame = useCurrentFrame();
  const scanY = interpolate(frame % 70, [0, 69], [102, 424], clamp);

  return (
    <>
      <Card style={{ position: "absolute", right: 68, top: 156, width: 430, height: 310, padding: 18, opacity: interpolate(frame, [20, 42], [0, 1], { ...clamp, easing: ease }) }}>
        <div style={{ height: "100%", borderRadius: 16, background: "linear-gradient(135deg, #1C1B1A 0%, #364B5B 42%, #D97757 100%)", overflow: "hidden", position: "relative" }}>
          <div style={{ position: "absolute", left: 38, top: 54, width: 138, height: 138, borderRadius: 999, background: "rgba(245,243,236,0.88)", scale: interpolate(frame, [36, 58], [0.88, 1], { ...clamp, easing: Easing.spring({ damping: 18 }), output: "perceptual-scale" }) }} />
          <div style={{ position: "absolute", left: 0, right: 0, top: scanY, height: 4, background: demo.accent, boxShadow: `0 0 24px ${demo.accent}` }} />
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ position: "absolute", right: 38 + i * 42, bottom: 42 + i * 28, width: 54, height: 86, borderRadius: 12, border: "2px solid rgba(245,243,236,0.55)", opacity: interpolate(frame, [44 + i * 7, 64 + i * 7], [0, 1], { ...clamp, easing: ease }) }} />
          ))}
        </div>
      </Card>
      <PromptPanel demo={demo} />
      <OutputPanel demo={demo} />
    </>
  );
};

const GenerateScene: React.FC<{ demo: DemoConfig }> = ({ demo }) => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [40, 128], [0, 1], clamp);

  return (
    <>
      <PromptPanel demo={demo} />
      <Card style={{ position: "absolute", right: 72, top: 140, width: 432, height: 372, padding: 18, opacity: interpolate(frame, [34, 58], [0, 1], { ...clamp, easing: ease }) }}>
        <div style={{ height: "100%", borderRadius: 18, background: "radial-gradient(circle at 38% 30%, #F5F3EC 0 10%, transparent 11%), linear-gradient(145deg, #223027, #7C8F5D 48%, #E7B88A)", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", left: 42, right: 42, bottom: 36, height: 9, borderRadius: 999, background: "rgba(245,243,236,0.35)", overflow: "hidden" }}>
            <div style={{ width: `${progress * 100}%`, height: "100%", borderRadius: 999, background: "#F5F3EC" }} />
          </div>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ position: "absolute", left: 72 + i * 66, top: 86 + (i % 2) * 36, width: 42, height: 42, borderRadius: 14, background: "rgba(245,243,236,0.72)", opacity: interpolate(frame, [52 + i * 12, 72 + i * 12], [0, 1], { ...clamp, easing: ease }), scale: interpolate(frame, [52 + i * 12, 72 + i * 12], [0.7, 1], { ...clamp, easing: Easing.spring({ damping: 20 }), output: "perceptual-scale" }) }} />
          ))}
        </div>
      </Card>
    </>
  );
};

const AudioScene: React.FC<{ demo: DemoConfig }> = ({ demo }) => {
  const frame = useCurrentFrame();

  return (
    <>
      <Card style={{ position: "absolute", left: 62, bottom: 58, width: 820, height: 246, padding: 28, opacity: interpolate(frame, [22, 46], [0, 1], { ...clamp, easing: ease }) }}>
        <div style={{ display: "flex", alignItems: "end", gap: 10, height: 112 }}>
          {Array.from({ length: 28 }).map((_, i) => {
            const phase = (frame + i * 6) % 48;
            return <div key={i} style={{ width: 17, height: interpolate(phase, [0, 24, 47], [24, 102, 32], clamp), borderRadius: 999, background: i % 4 === 0 ? demo.accent : "rgba(106,155,204,0.55)" }} />;
          })}
        </div>
        <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
          {["00:04 Intro", "00:18 Dialogue", "00:41 Beat change"].map((label, i) => (
            <div key={label} style={{ padding: "10px 14px", borderRadius: 999, color: "#141413", background: i === 1 ? `${demo.accent}33` : "rgba(20,20,19,0.06)", fontSize: 18, fontWeight: 700, opacity: interpolate(frame, [54 + i * 12, 72 + i * 12], [0, 1], { ...clamp, easing: ease }) }}>
              {label}
            </div>
          ))}
        </div>
      </Card>
      <OutputPanel demo={demo} />
    </>
  );
};

const EditScene: React.FC<{ demo: DemoConfig }> = ({ demo }) => {
  const frame = useCurrentFrame();
  const playhead = interpolate(frame % 120, [0, 119], [86, 794], clamp);

  return (
    <Card style={{ position: "absolute", left: 58, right: 58, bottom: 52, height: 360, padding: 26, opacity: interpolate(frame, [18, 42], [0, 1], { ...clamp, easing: ease }) }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.08fr 0.92fr", gap: 22 }}>
        <div style={{ height: 202, borderRadius: 18, background: "linear-gradient(140deg, #141413, #3A4150 45%, #D97757 100%)", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", left: 44, top: 42, width: 120, height: 120, borderRadius: 26, background: "rgba(245,243,236,0.78)", rotate: `${interpolate(frame, [46, 118], [-4, 6], clamp)}deg` }} />
          <div style={{ position: "absolute", right: 28, bottom: 28, color: "#F5F3EC", fontSize: 20, fontWeight: 800 }}>Color preset applied</div>
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          {["Cut 00:05 - 00:12", "Add dissolve", "Match upbeat music"].map((label, i) => (
            <div key={label} style={{ height: 56, borderRadius: 16, padding: "0 18px", display: "flex", alignItems: "center", color: "#141413", background: i === 1 ? `${demo.accent}22` : "rgba(20,20,19,0.06)", fontSize: 19, fontWeight: 700, opacity: interpolate(frame, [52 + i * 11, 70 + i * 11], [0, 1], { ...clamp, easing: ease }), translate: `${interpolate(frame, [52 + i * 11, 70 + i * 11], [24, 0], { ...clamp, easing: ease })}px 0` }}>
              {label}
            </div>
          ))}
        </div>
      </div>
      <div style={{ position: "relative", marginTop: 24, height: 70 }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 28, height: 10, borderRadius: 999, background: "rgba(20,20,19,0.08)" }} />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ position: "absolute", left: 30 + i * 188, top: 15, width: i === 2 ? 170 : 130, height: 36, borderRadius: 12, background: i % 2 === 0 ? demo.accent : demo.secondary, opacity: 0.9 }} />
        ))}
        <div style={{ position: "absolute", left: playhead, top: 0, width: 4, height: 68, borderRadius: 999, background: "#141413" }} />
      </div>
    </Card>
  );
};

export const FeatureDemo: React.FC<{ demo: DemoConfig }> = ({ demo }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const pulse = interpolate(frame % 60, [0, 30, 59], [0.6, 1, 0.6], clamp);

  return (
    <AbsoluteFill
      style={{
        fontFamily,
        background: "radial-gradient(circle at 22% 16%, rgba(217,119,87,0.16), transparent 32%), radial-gradient(circle at 78% 20%, rgba(106,155,204,0.16), transparent 28%), linear-gradient(135deg, #ECE9E0, #F8F6EF)",
        overflow: "hidden",
      }}
    >
      <div style={{ position: "absolute", inset: 28, borderRadius: 34, border: "1px solid rgba(20,20,19,0.08)", background: "rgba(245,243,236,0.52)" }} />
      <div style={{ position: "absolute", right: 74, top: 70, width: 108, height: 108, borderRadius: 999, background: demo.accent, opacity: 0.16 * pulse, scale: interpolate(frame % durationInFrames, [0, durationInFrames - 1], [0.9, 1.18], { ...clamp, output: "perceptual-scale" }) }} />
      <Header demo={demo} />
      {demo.kind === "analyze" && <AnalyzeScene demo={demo} />}
      {demo.kind === "generate" && <GenerateScene demo={demo} />}
      {demo.kind === "audio" && <AudioScene demo={demo} />}
      {demo.kind === "edit" && <EditScene demo={demo} />}
    </AbsoluteFill>
  );
};