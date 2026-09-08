import { Composition } from "remotion";
import { FeatureDemo, featureDemos } from "./feature-demo";
import { PromptLensLandingAd } from "./prompt-lens-landing-ad";
import { PromptLensProductDemo } from "./prompt-lens-product-demo";
import { PromptLensCoreWorkflowDemo } from "./prompt-lens-core-workflow-demo";
import { PromptLensRemixComparisonDemo } from "./prompt-lens-remix-comparison-demo";
import { PromptLensAnalysisMotionDemo } from "./prompt-lens-analysis-motion-demo";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="PromptLensAnalysisMotionDemo"
        component={PromptLensAnalysisMotionDemo}
        durationInFrames={600}
        fps={30}
        width={1200}
        height={950}
      />
      {featureDemos.map((demo) => (
        <Composition
          key={demo.id}
          id={demo.id}
          component={FeatureDemo}
          durationInFrames={150}
          fps={30}
          width={960}
          height={720}
          defaultProps={{ demo }}
        />
      ))}
      <Composition
        id="PromptLensCoreWorkflowDemo"
        component={PromptLensCoreWorkflowDemo}
        durationInFrames={756}
        fps={30}
        width={1200}
        height={950}
      />
      <Composition
        id="PromptLensRemixComparisonDemo"
        component={PromptLensRemixComparisonDemo}
        durationInFrames={390}
        fps={30}
        width={1200}
        height={950}
      />
      <Composition
        id="PromptLensProductDemo"
        component={PromptLensProductDemo}
        durationInFrames={378}
        fps={30}
        width={1200}
        height={950}
      />
      <Composition
        id="PromptLensLandingAd"
        component={PromptLensLandingAd}
        durationInFrames={900}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
