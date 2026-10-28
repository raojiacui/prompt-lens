#!/usr/bin/env python3
"""Detect video scenes and extract three representative frames per scene.

Inputs are local files only. The script invokes local ffmpeg/ffprobe, writes to a
new or empty output directory, and never installs dependencies or uses network APIs.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

PTS_TIME = re.compile(r"pts_time:([0-9]+(?:\.[0-9]+)?)")


def fail(message: str) -> None:
    raise RuntimeError(message)


def run(command: list[str], timeout: int) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        fail(f"Command timed out after {timeout}s: {command[0]}")
    except subprocess.CalledProcessError as error:
        detail = (error.stderr or error.stdout or "").strip()[-2000:]
        fail(f"{command[0]} failed: {detail}")


def rational(value: str | None) -> float | None:
    if not value or value in {"0/0", "N/A"}:
        return None
    try:
        numerator, denominator = value.split("/", 1)
        return float(numerator) / float(denominator)
    except (ValueError, ZeroDivisionError):
        return None


def probe(input_path: Path, ffprobe: str, timeout: int) -> dict[str, Any]:
    result = run(
        [
            ffprobe,
            "-v",
            "error",
            "-show_format",
            "-show_streams",
            "-of",
            "json",
            str(input_path),
        ],
        timeout,
    )
    payload = json.loads(result.stdout)
    streams = payload.get("streams") or []
    video = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
    if not video:
        fail("No video stream was found in the input file.")
    duration_values = [payload.get("format", {}).get("duration"), video.get("duration")]
    duration = next((float(value) for value in duration_values if value not in {None, "N/A"}), 0.0)
    if not math.isfinite(duration) or duration <= 0:
        fail("Video duration is missing or invalid.")
    return {
        "duration": round(duration, 6),
        "width": video.get("width"),
        "height": video.get("height"),
        "frameRate": rational(video.get("avg_frame_rate")) or rational(video.get("r_frame_rate")),
        "videoCodec": video.get("codec_name"),
        "hasAudio": any(stream.get("codec_type") == "audio" for stream in streams),
        "audioCodec": next(
            (stream.get("codec_name") for stream in streams if stream.get("codec_type") == "audio"),
            None,
        ),
        "bytes": input_path.stat().st_size,
    }


def detect_cuts(
    input_path: Path,
    ffmpeg: str,
    duration: float,
    threshold: float,
    min_scene: float,
    timeout: int,
) -> list[float]:
    result = run(
        [
            ffmpeg,
            "-hide_banner",
            "-nostdin",
            "-loglevel",
            "info",
            "-i",
            str(input_path),
            "-filter:v",
            f"select=gt(scene\\,{threshold}),showinfo",
            "-an",
            "-f",
            "null",
            "-",
        ],
        timeout,
    )
    candidates = sorted({float(match.group(1)) for match in PTS_TIME.finditer(result.stderr)})
    cuts: list[float] = []
    previous = 0.0
    for value in candidates:
        if value <= 0.05 or value >= duration - 0.05:
            continue
        if value - previous < min_scene:
            continue
        cuts.append(value)
        previous = value
    return cuts


def base_scenes(duration: float, cuts: list[float], min_scene: float) -> list[tuple[float, float]]:
    boundaries = [0.0, *cuts, duration]
    scenes: list[tuple[float, float]] = []
    for start, end in zip(boundaries, boundaries[1:]):
        if end - start < min_scene and scenes:
            prior_start, _ = scenes[-1]
            scenes[-1] = (prior_start, end)
        elif end > start:
            scenes.append((start, end))
    return scenes or [(0.0, duration)]


def seeded_fraction(seed: str) -> float:
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    return int.from_bytes(digest[:4], "big") / 2**32


def split_long_scenes(
    scenes: list[tuple[float, float]],
    seed: str,
    max_duration: float,
    target_duration: float,
) -> list[tuple[float, float]]:
    result: list[tuple[float, float]] = []
    for start, end in scenes:
        duration = end - start
        if duration <= max_duration:
            result.append((start, end))
            continue
        minimum_count = math.ceil(duration / 10.0)
        maximum_count = math.floor(duration / 8.0)
        feasible = minimum_count <= maximum_count
        count = (
            max(minimum_count, min(maximum_count, round(duration / target_duration)))
            if feasible
            else max(2, round(duration / target_duration))
        )
        average = duration / count
        minimum = 8.0 if feasible else max(0.6, average - 0.75)
        maximum = 10.0 if feasible else min(max_duration, average + 0.75)
        cursor = start
        for index in range(count):
            remaining = count - index - 1
            lower = max(minimum, end - cursor - remaining * maximum)
            upper = min(maximum, end - cursor - remaining * minimum)
            length = end - cursor if remaining == 0 else lower + seeded_fraction(
                f"{seed}:{start:.6f}:{end:.6f}:{index}"
            ) * max(0.0, upper - lower)
            next_time = min(end, cursor + length)
            result.append((cursor, next_time))
            cursor = next_time
    return result


def extract_frame(
    input_path: Path,
    output_path: Path,
    timestamp: float,
    ffmpeg: str,
    timeout: int,
) -> None:
    run(
        [
            ffmpeg,
            "-hide_banner",
            "-nostdin",
            "-loglevel",
            "error",
            "-ss",
            f"{timestamp:.6f}",
            "-i",
            str(input_path),
            "-map",
            "0:v:0",
            "-frames:v",
            "1",
            "-vf",
            "scale=1280:-2:force_original_aspect_ratio=decrease",
            "-q:v",
            "2",
            "-y",
            str(output_path),
        ],
        timeout,
    )


def write_storyboard(output_dir: Path, manifest: dict[str, Any]) -> None:
    metadata = manifest["media"]
    lines = [
        "# Video storyboard",
        "",
        f"- Source: `{manifest['source']['name']}`",
        f"- Duration: {metadata['duration']:.3f}s",
        f"- Size: {metadata.get('width')}×{metadata.get('height')}",
        f"- Scenes: {len(manifest['scenes'])}",
        "",
        "| Scene | Time | Duration | Frames |",
        "| ---: | --- | ---: | --- |",
    ]
    for scene in manifest["scenes"]:
        links = " · ".join(f"[{frame['label']}]({frame['path']})" for frame in scene["frames"])
        lines.append(
            f"| {scene['sceneIndex']} | {scene['start']:.3f}–{scene['end']:.3f}s | "
            f"{scene['duration']:.3f}s | {links} |"
        )
    for scene in manifest["scenes"]:
        lines.extend(["", f"## Scene {scene['sceneIndex']}", ""])
        for frame in scene["frames"]:
            lines.extend(
                [
                    f"### {frame['label']} · {frame['timestamp']:.3f}s",
                    "",
                    f"![Scene {scene['sceneIndex']} {frame['label']}]({frame['path']})",
                    "",
                ]
            )
    (output_dir / "storyboard.md").write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="Local video file")
    parser.add_argument("--output", required=True, help="New or empty output directory")
    parser.add_argument("--scene-threshold", type=float, default=0.32)
    parser.add_argument("--min-scene-seconds", type=float, default=0.6)
    parser.add_argument("--max-scene-seconds", type=float, default=15.0)
    parser.add_argument("--target-segment-seconds", type=float, default=9.0)
    parser.add_argument("--max-scenes", type=int, default=80)
    parser.add_argument("--max-input-mb", type=int, default=2048)
    parser.add_argument("--timeout-seconds", type=int, default=900)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    input_path = Path(args.input).expanduser().resolve()
    output_dir = Path(args.output).expanduser().resolve()
    if not input_path.is_file():
        fail(f"Input file does not exist: {input_path}")
    if input_path.stat().st_size > args.max_input_mb * 1024 * 1024:
        fail(f"Input exceeds --max-input-mb ({args.max_input_mb} MB).")
    if not 0.05 <= args.scene_threshold <= 0.95:
        fail("--scene-threshold must be between 0.05 and 0.95.")
    if args.min_scene_seconds <= 0 or args.max_scene_seconds <= args.min_scene_seconds:
        fail("Scene duration limits are invalid.")
    if args.target_segment_seconds <= 0 or args.max_scenes <= 0 or args.timeout_seconds <= 0:
        fail("Target duration, scene limit, and timeout must be positive.")
    if output_dir.exists() and not output_dir.is_dir():
        fail(f"Output path exists and is not a directory: {output_dir}")
    if output_dir.exists() and any(output_dir.iterdir()):
        fail(f"Output directory is not empty: {output_dir}")
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        fail("ffmpeg and ffprobe are required. Ask the user before installing missing tools.")

    metadata = probe(input_path, ffprobe, args.timeout_seconds)
    cuts = detect_cuts(
        input_path,
        ffmpeg,
        metadata["duration"],
        args.scene_threshold,
        args.min_scene_seconds,
        args.timeout_seconds,
    )
    scenes = split_long_scenes(
        base_scenes(metadata["duration"], cuts, args.min_scene_seconds),
        f"{input_path.name}:{metadata['bytes']}:{metadata['duration']}",
        args.max_scene_seconds,
        args.target_segment_seconds,
    )
    if len(scenes) > args.max_scenes:
        fail(
            f"Detected {len(scenes)} scenes, above --max-scenes={args.max_scenes}. "
            "Ask the user before rerunning with a larger limit."
        )

    output_dir.mkdir(parents=True, exist_ok=True)
    frames_dir = output_dir / "frames"
    frames_dir.mkdir()
    scene_entries: list[dict[str, Any]] = []
    samples = [("opening", 0.10), ("middle", 0.50), ("closing", 0.90)]
    for index, (start, end) in enumerate(scenes, 1):
        duration = end - start
        frame_entries = []
        for label, fraction in samples:
            timestamp = min(end - 0.001, max(start, start + duration * fraction))
            relative = Path("frames") / f"scene-{index:03d}-{label}.jpg"
            extract_frame(input_path, output_dir / relative, timestamp, ffmpeg, args.timeout_seconds)
            frame_entries.append(
                {
                    "label": label,
                    "fraction": fraction,
                    "timestamp": round(timestamp, 6),
                    "path": relative.as_posix(),
                }
            )
        scene_entries.append(
            {
                "sceneIndex": index,
                "start": round(start, 6),
                "end": round(end, 6),
                "duration": round(duration, 6),
                "frames": frame_entries,
            }
        )

    manifest = {
        "schemaVersion": 1,
        "source": {"name": input_path.name, "path": str(input_path)},
        "media": metadata,
        "detection": {
            "method": "ffmpeg-scene-filter",
            "sceneThreshold": args.scene_threshold,
            "minSceneSeconds": args.min_scene_seconds,
            "maxSceneSeconds": args.max_scene_seconds,
            "targetSegmentSeconds": args.target_segment_seconds,
            "detectedCuts": [round(value, 6) for value in cuts],
        },
        "scenes": scene_entries,
    }
    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    write_storyboard(output_dir, manifest)
    print(json.dumps({"output": str(output_dir), "scenes": len(scene_entries)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
