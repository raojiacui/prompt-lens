"""Evaluate shot boundaries against Shotcut markers without uploading media."""
import argparse
import importlib.util
import json
import xml.etree.ElementTree as ET
from pathlib import Path


def seconds(value):
    hours, minutes, seconds_part = value.split(":")
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds_part)


def read_project(path):
    root = ET.parse(path).getroot()
    playlist = root.find(".//playlist[@id='playlist0']")
    entries = playlist.findall("entry") if playlist is not None else []
    if len(entries) != 1 or playlist.find("blank") is not None or seconds(entries[0].get("in", "0:0:0")) != 0:
        raise ValueError("Use one untrimmed video at timeline zero.")
    producer = root.find(f".//*[@id='{entries[0].get('producer')}']")
    if producer is None or producer.find("property[@name='warp_speed']") is not None:
        raise ValueError("Retimed media is not supported.")
    resource = producer.find("property[@name='resource']")
    if resource is None:
        raise ValueError("Missing video resource.")
    video = Path(resource.text)
    if not video.is_absolute():
        video = path.parent / video
    marker_group = root.find(".//properties[@name='shotcut:markers']")
    if marker_group is None:
        raise ValueError("No Shotcut markers found.")
    markers = []
    for marker in marker_group.findall("properties"):
        start = marker.find("property[@name='start']")
        end = marker.find("property[@name='end']")
        if start is None or end is None or start.text != end.text:
            raise ValueError("Use point markers, not ranges.")
        markers.append(seconds(start.text))
    if len(set(markers)) != len(markers):
        raise ValueError("Duplicate marker times.")
    if not markers:
        raise ValueError("No point markers found.")
    return video.resolve(), sorted(markers)


def match_boundaries(expected, predicted, tolerance):
    """Maximize one-to-one matches, then minimize their total timing error."""
    rows = [[(0, 0.0, []) for _ in range(len(predicted) + 1)] for _ in range(len(expected) + 1)]
    for i, target in enumerate(expected, 1):
        for j, cut in enumerate(predicted, 1):
            choices = [rows[i - 1][j], rows[i][j - 1]]
            if abs(target - cut) <= tolerance:
                count, error, pairs = rows[i - 1][j - 1]
                choices.append((count + 1, error + abs(target - cut), pairs + [(i - 1, j - 1)]))
            rows[i][j] = max(choices, key=lambda item: (item[0], -item[1]))
    pairs = rows[-1][-1][2]
    hits = len(pairs)
    precision = hits / len(predicted) if predicted else 0.0
    recall = hits / len(expected) if expected else 0.0
    matched_targets = {i for i, _ in pairs}
    matched_cuts = {j for _, j in pairs}
    return {
        "expected": len(expected), "predicted": len(predicted), "hits": hits,
        "precision": round(precision, 4), "recall": round(recall, 4),
        "f1": round(2 * precision * recall / (precision + recall), 4) if precision + recall else 0.0,
        "missed": [value for i, value in enumerate(expected) if i not in matched_targets],
        "extra": [value for j, value in enumerate(predicted) if j not in matched_cuts],
        "matches": [{"marker": expected[i], "cut": predicted[j], "offset": round(predicted[j] - expected[i], 3)} for i, j in pairs],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--tolerance", type=float, default=0.5)
    parser.add_argument("--suite", choices=["initial", "refinement"], default="initial")
    args = parser.parse_args()
    if args.tolerance <= 0:
        parser.error("Tolerance must be positive.")
    video_path, markers = read_project(args.project)
    import scenedetect
    from scenedetect import detect, open_video
    spec = importlib.util.spec_from_file_location("worker_scene_detection", Path(__file__).resolve().parents[1] / "workers/ffmpeg-worker/scene-detect.py")
    worker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker)
    video = open_video(str(video_path))
    duration = video.duration.seconds
    fps = float(video.frame_rate)
    if any(point <= 0 or point >= duration for point in markers):
        raise ValueError("Markers must be inside the video.")
    min_scene_len = max(1, round(0.6 * fps))
    configs = [
        {"name": "current-adaptive", "detector": "adaptive", "threshold": 27, "adaptive_threshold": 3, "min_content_val": 15, "window_width": 2},
        {"name": "content-27", "detector": "content", "threshold": 27},
        {"name": "content-20", "detector": "content", "threshold": 20},
        {"name": "content-15", "detector": "content", "threshold": 15},
        {"name": "content-10", "detector": "content", "threshold": 10},
        {"name": "adaptive-low-content", "detector": "adaptive", "adaptive_threshold": 3, "min_content_val": 8, "window_width": 2},
        {"name": "adaptive-sensitive", "detector": "adaptive", "adaptive_threshold": 2, "min_content_val": 8, "window_width": 2},
        {"name": "adaptive-wide-window", "detector": "adaptive", "adaptive_threshold": 2, "min_content_val": 8, "window_width": 12},
    ]
    if args.suite == "refinement":
        configs = [configs[0]] + [
            {"name": f"adaptive-ratio-{ratio}-window-{window}", "detector": "adaptive",
             "adaptive_threshold": ratio, "min_content_val": 15, "window_width": window}
            for ratio, window in [(2.5, 2), (3.5, 2), (3, 5), (3, 12), (2.5, 5), (3.5, 5)]
        ]
    report = {"version": scenedetect.__version__, "video": str(video_path), "duration": duration,
              "fps": fps, "markers": markers, "tolerance": args.tolerance,
              "note": "One video only. Temporal holdout is not independent-video validation.",
              "results": []}
    split = duration * 2 / 3
    for config in configs:
        print(f"Evaluating {config['name']}...", flush=True)
        detector = worker.build_detector(config["detector"], config.get("threshold", 27),
                                         config.get("adaptive_threshold", 3), min_scene_len,
                                         config.get("min_content_val", 15), config.get("window_width", 2))
        scenes = detect(str(video_path), detector)
        # Mirror the worker's exclusion of boundaries within 0.6 sec of either end.
        cuts = sorted({round(start.seconds, 3) for start, _ in scenes if 0.6 < start.seconds < duration - 0.6})
        result = {"config": config, "cuts": cuts,
                  "all": match_boundaries(markers, cuts, args.tolerance),
                  "tuning": match_boundaries([t for t in markers if t < split], [t for t in cuts if t < split], args.tolerance),
                  "holdout": match_boundaries([t for t in markers if t >= split], [t for t in cuts if t >= split], args.tolerance)}
        report["results"].append(result)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        scores = result["all"]
        print(f"  hits={scores['hits']}/{len(markers)}, extra={len(scores['extra'])}, F1={scores['f1']}", flush=True)
    best = max(report["results"], key=lambda result: result["tuning"]["f1"])
    report["tuning_candidate"] = best["config"]["name"]
    baseline = report["results"][0]
    report["candidate_passes_holdout"] = (
        best["holdout"]["recall"] >= baseline["holdout"]["recall"]
        and best["holdout"]["precision"] >= baseline["holdout"]["precision"]
        and best["holdout"]["f1"] > baseline["holdout"]["f1"]
    )
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Tuning candidate: {best['config']['name']}. No runtime defaults changed.", flush=True)
    print(f"Holdout improvement accepted: {report['candidate_passes_holdout']}", flush=True)


if __name__ == "__main__":
    main()
