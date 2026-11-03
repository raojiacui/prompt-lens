#!/usr/bin/env python3
"""Report local tools useful to the Prompt Lens video workflow.

This script performs read-only executable discovery. It never installs software,
reads credentials, accesses the network, or modifies user files.
"""

from __future__ import annotations

import json
import platform
import shutil
import subprocess
import sys


def tool(name: str, required: bool, purpose: str) -> dict[str, object]:
    path = shutil.which(name)
    return {
        "name": name,
        "required": required,
        "available": path is not None,
        "path": path,
        "purpose": purpose,
    }


def find_scenedetect_python() -> list[str] | None:
    candidates: list[list[str]] = [[sys.executable]]
    launcher = shutil.which("py")
    if launcher:
        candidates.extend([[launcher, f"-{version}"] for version in ("3.14", "3.13", "3.12", "3.11", "3.10", "3.9")])
    for name in ("python3", "python"):
        executable = shutil.which(name)
        if executable:
            candidates.append([executable])
    seen: set[tuple[str, ...]] = set()
    for command in candidates:
        key = tuple(command)
        if key in seen:
            continue
        seen.add(key)
        try:
            result = subprocess.run(
                [*command, "-c", "import scenedetect"],
                check=False,
                capture_output=True,
                timeout=10,
            )
            if result.returncode == 0:
                return command
        except (OSError, subprocess.TimeoutExpired):
            continue
    return None


def main() -> int:
    scenedetect_python = find_scenedetect_python()
    tools = [
        tool("ffmpeg", True, "detect scene changes and extract representative frames"),
        tool("ffprobe", True, "read video duration, streams, frame rate, and dimensions"),
        tool("yt-dlp", False, "download supported public video-page links with user approval"),
    ]
    payload = {
        "python": {
            "version": platform.python_version(),
            "executable": sys.executable,
            "supported": sys.version_info >= (3, 9),
        },
        "tools": tools,
        "preferredSceneDetector": {
            "name": "PySceneDetect AdaptiveDetector",
            "available": scenedetect_python is not None,
            "pythonCommand": scenedetect_python,
            "parameters": {
                "adaptiveThreshold": 3.0,
                "minContentVal": 15.0,
                "windowWidth": 2,
                "minSceneSeconds": 0.6,
            },
            "fallback": "FFmpeg scene filter at 0.32",
        },
        "readyForLocalFiles": sys.version_info >= (3, 9)
        and all(item["available"] for item in tools if item["required"]),
        "notes": [
            "A multimodal agent capable of inspecting images is required for visual analysis.",
            "No API key is required when the current agent can inspect the extracted frames.",
            "Prefer PySceneDetect AdaptiveDetector when available; otherwise explain the FFmpeg fallback.",
            "Missing software must not be installed without the user's approval.",
        ],
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if payload["readyForLocalFiles"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
