#!/usr/bin/env python3
"""Conservative, local-only refinement shared by both scene detectors."""
import argparse
from collections import deque
import json
import queue
import re
import subprocess
import sys
import threading

import cv2
import numpy as np

REVISION = "content-scenes-v2"
WIDTH, HEIGHT = 640, 360


def is_empty_frame(frame):
    # Require near-pure RGB black/white, not merely a low/high average luma.
    # Small connected foreground marks protect titles, logos and light sources.
    distance = frame if float(frame.mean()) < 128 else 255 - frame
    if float(distance.mean()) > 1.5 or float(distance.std()) > 1.25:
        return False
    foreground = np.max(distance, axis=2) > 12
    if not foreground.any():
        return True
    count, _, stats, _ = cv2.connectedComponentsWithStats(foreground.astype(np.uint8), 8)
    return count <= 1 or int(stats[1:, cv2.CC_STAT_AREA].max()) < 4


def has_motion_continuity(before, after):
    # A cut is removed only with both image agreement and distributed feature
    # tracks. Similar colors or a shared static corner alone cannot merge shots.
    def gray(frame):
        value = cv2.cvtColor(cv2.resize(frame, (320, 180)), cv2.COLOR_BGR2GRAY)
        return value[18:-18, 16:-16].copy()
    a, b = gray(before), gray(after)
    if min(float(a.std()), float(b.std())) < 8:
        return False
    delta = np.abs(a.astype(np.float32) - b.astype(np.float32))
    if float(delta.mean()) > 22 or float(np.mean(delta > 25)) > 0.25:
        return False
    if float(np.corrcoef(a.ravel(), b.ravel())[0, 1]) < 0.85:
        return False
    points = cv2.goodFeaturesToTrack(a, 200, 0.02, 6)
    if points is None or len(points) < 30:
        return False
    forward, status, error = cv2.calcOpticalFlowPyrLK(a, b, points, None, winSize=(21, 21), maxLevel=3)
    if forward is None:
        return False
    backward, back_status, _ = cv2.calcOpticalFlowPyrLK(b, a, forward, None, winSize=(21, 21), maxLevel=3)
    if backward is None:
        return False
    good = ((status[:, 0] == 1) & (back_status[:, 0] == 1)
            & (np.linalg.norm(points[:, 0] - backward[:, 0], axis=1) < 1)
            & (error[:, 0] < 10))
    if int(good.sum()) < 30 or float(good.mean()) < 0.65:
        return False
    cells = {(min(2, int(x / a.shape[1] * 3)), min(2, int(y / a.shape[0] * 3)))
             for x, y in points[:, 0][good]}
    return len(cells) >= 5


def useful_intervals(cuts, excluded, duration, minimum=0.6):
    """Subtract empty runs without closing gaps or moving original timestamps."""
    runs, cursor = [], 0.0
    for start, end in excluded:
        start, end = max(0, start), min(duration, end)
        if start > cursor:
            runs.append((cursor, start))
        cursor = max(cursor, end)
    if cursor < duration:
        runs.append((cursor, duration))
    scenes = []
    for start, end in runs:
        boundaries = [start]
        for cut in sorted(set(cuts)):
            # Keep short real content, but do not create tiny fragments beside
            # a blank transition or a detector's rounded frame timestamp.
            if cut - boundaries[-1] >= min(minimum, 0.12) and end - cut >= min(minimum, 0.12):
                boundaries.append(cut)
        boundaries.append(end)
        scenes.extend({"start": round(a, 6), "end": round(b, 6)}
                      for a, b in zip(boundaries, boundaries[1:]) if b > a)
    return scenes


def refine_video(path, cuts, duration, stream_index=0, ffmpeg="ffmpeg", minimum=0.6):
    timestamps = queue.Queue()
    errors = deque(maxlen=20)
    process = subprocess.Popen([
        ffmpeg, "-hide_banner", "-nostdin", "-xerror", "-i", path,
        "-map", f"0:{stream_index}", "-an", "-sn", "-dn",
        "-vf", f"scale={WIDTH}:{HEIGHT},showinfo", "-fps_mode", "passthrough",
        "-pix_fmt", "bgr24", "-f", "rawvideo", "pipe:1",
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    def read_metadata():
        try:
            for raw in iter(process.stderr.readline, b""):
                line = raw.decode("utf-8", errors="replace")
                match = re.search(r"\bn:\s*\d+.*?\bpts_time:([-\d.e+]+)", line)
                if match:
                    timestamps.put(float(match.group(1)))
                elif "showinfo" not in line:
                    errors.append(line.strip())
        finally:
            timestamps.put(None)

    reader = threading.Thread(target=read_metadata, daemon=True)
    reader.start()
    kept, removed, excluded = [], [], []
    pending = deque(sorted(set(cuts)))
    previous = None
    empty_start = None
    first_time = None
    frame_count = 0
    frame_bytes = WIDTH * HEIGHT * 3
    try:
        while True:
            # Buffered read fills a frame unless the decoder has reached EOF.
            raw = process.stdout.read(frame_bytes)
            if not raw:
                break
            if len(raw) != frame_bytes:
                raise ValueError("Incomplete refinement frame")
            timestamp = timestamps.get(timeout=30)
            if timestamp is None:
                raise ValueError("Missing refinement frame timestamp")
            if first_time is None:
                first_time = timestamp
            timestamp -= first_time
            if timestamp < 0 or (frame_count and timestamp <= last_time):
                raise ValueError("Non-monotonic refinement timestamps")
            last_time = timestamp
            frame_count += 1
            frame = np.frombuffer(raw, np.uint8).reshape(HEIGHT, WIDTH, 3)
            empty = is_empty_frame(frame)
            if empty and empty_start is None:
                empty_start = timestamp
            elif not empty and empty_start is not None:
                excluded.append((empty_start, timestamp))
                empty_start = None
            while pending and pending[0] <= timestamp + 0.001:
                cut = pending.popleft()
                if previous is not None and not empty and not is_empty_frame(previous) and has_motion_continuity(previous, frame):
                    removed.append(cut)
                else:
                    kept.append(cut)
            previous = frame
        if process.wait(timeout=30) != 0 or not frame_count:
            raise ValueError("Refinement decode failed: " + " ".join(errors))
        if pending:
            raise ValueError("Refinement did not decode all scene boundaries")
        if empty_start is not None:
            excluded.append((empty_start, duration))
        return {
            "revision": REVISION,
            "scenes": useful_intervals(kept, excluded, duration, minimum),
            "excludedIntervals": [{"start": round(a, 6), "end": round(b, 6)} for a, b in excluded],
            "removedCuts": removed,
            "decodedFrames": frame_count,
        }
    finally:
        if process.poll() is None:
            process.kill()
        process.wait()
        reader.join(timeout=5)
        process.stdout.close()
        process.stderr.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--cuts", required=True)
    parser.add_argument("--duration", required=True, type=float)
    parser.add_argument("--stream-index", type=int, default=0)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--min-scene-seconds", type=float, default=0.6)
    args = parser.parse_args()
    cuts = json.loads(args.cuts)
    if args.duration <= 0 or not isinstance(cuts, list) or any(not isinstance(cut, (int, float)) or not 0 < cut < args.duration for cut in cuts):
        raise ValueError("Invalid refinement boundaries")
    print(json.dumps(refine_video(args.input, cuts, args.duration, args.stream_index, args.ffmpeg, args.min_scene_seconds)))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
