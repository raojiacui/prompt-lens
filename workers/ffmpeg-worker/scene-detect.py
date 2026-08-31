#!/usr/bin/env python3
import argparse
import json
import sys

from scenedetect import AdaptiveDetector, ContentDetector, detect


def build_detector(name, threshold, adaptive_threshold, min_scene_len):
    if name == "content":
        return ContentDetector(threshold=threshold, min_scene_len=min_scene_len)
    return AdaptiveDetector(
        adaptive_threshold=adaptive_threshold,
        min_scene_len=min_scene_len,
    )


def main():
    parser = argparse.ArgumentParser(description="Detect scene boundaries with PySceneDetect.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--detector", choices=["adaptive", "content"], default="adaptive")
    parser.add_argument("--threshold", type=float, default=27.0)
    parser.add_argument("--adaptive-threshold", type=float, default=3.0)
    parser.add_argument("--min-scene-seconds", type=float, default=0.6)
    parser.add_argument("--fps", type=float, default=30.0)
    args = parser.parse_args()

    min_scene_len = max(1, int(round(args.min_scene_seconds * max(args.fps, 1.0))))
    detector = build_detector(
        args.detector,
        args.threshold,
        args.adaptive_threshold,
        min_scene_len,
    )

    scenes = detect(args.input, detector)
    payload = {
        "detector": args.detector,
        "threshold": args.threshold,
        "adaptiveThreshold": args.adaptive_threshold,
        "minSceneLenFrames": min_scene_len,
        "scenes": [
            {
                "start": round(start.seconds, 3),
                "end": round(end.seconds, 3),
            }
            for start, end in scenes
        ],
    }
    print(json.dumps(payload))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
