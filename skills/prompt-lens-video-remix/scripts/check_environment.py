#!/usr/bin/env python3
"""Report local tools useful to the Prompt Lens video workflow.

This script performs read-only executable discovery. It never installs software,
reads credentials, accesses the network, or modifies user files.
"""

from __future__ import annotations

import json
import platform
import shutil
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


def main() -> int:
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
        "readyForLocalFiles": sys.version_info >= (3, 9)
        and all(item["available"] for item in tools if item["required"]),
        "notes": [
            "A multimodal agent capable of inspecting images is required for visual analysis.",
            "No API key is required when the current agent can inspect the extracted frames.",
            "Missing software must not be installed without the user's approval.",
        ],
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if payload["readyForLocalFiles"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
