import { Composition } from "remotion";
import { FeatureDemo, featureDemos } from "./feature-demo";

export const RemotionRoot: React.FC = () => {
  return (
    <>
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
    </>
  );
};