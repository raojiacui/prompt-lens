# Local video workflow

Use this reference to choose an input route, obtain only the permissions needed, and keep the workflow portable across agents.

## 1. Choose the input route

### Local file

Use the exact file the user named or attached. Confirm the resolved path before running a long operation. Reading the named file is within the analysis request; writing output should stay inside a new directory beside the user's project or in a location the user selected.

### Direct media URL

A URL that directly returns a video file can be downloaded with an available browser/download tool. Tell the user where the local copy will be written. Do not place credentials in the URL, log signed query strings, or persist temporary access tokens.

### Public video-page URL

If `yt-dlp` is already available and supports the public page, it may be used after telling the user that the video will be downloaded locally for analysis. Respect the platform's terms and the user's rights to the content. Never bypass DRM, login, membership, geographic restrictions, or private access.

If the required downloader is missing, explain the dependency and ask whether the user wants it installed. Do not install it merely because the analysis would benefit from it. If the user declines, request a local video file or direct media URL.

## 2. Preflight

Run `scripts/check_environment.py` before preparing media.

- `ffmpeg` and `ffprobe` are required for the included preparation script.
- Python 3.9 or newer is required for the scripts.
- `yt-dlp` is optional and only relevant to supported public video-page links.
- A multimodal agent that can inspect JPEG images is required for the no-API path.

When native visual capability is unavailable, offer the user a choice:

1. Move the task to an agent/model with image understanding.
2. Configure their own supported vision API through the agent's secret manager or a provider-standard environment variable.

Before sending any frame, audio, transcript, or prompt to an external API, name the provider, identify what data will leave the machine, mention possible charges, and obtain explicit approval. Never enumerate or read unrelated environment variables.

## 3. Prepare local evidence

Run `scripts/prepare_video.py` into a new or empty directory. The defaults use FFmpeg's scene-change score at `0.32`, keep scenes at least `0.6` seconds apart, split continuous segments longer than `15` seconds toward roughly `8–10` seconds, and sample frames at 10%, 50%, and 90% of each segment.

The script produces:

- `manifest.json`: machine-readable metadata, boundaries, timestamps, and frame paths.
- `storyboard.md`: a browsable timeline and embedded frame index.
- `frames/`: three JPEGs per scene.

Each analysis segment includes `shotGroupIndex` and `isDurationSplit`. Segments with the same shot group belong to one continuous detected shot; `isDurationSplit: true` means the segment was created only to keep a long continuous section manageable and must not be described as a detected edit.

If cuts are too frequent, increase `--scene-threshold`. If clear cuts are missing, decrease it. Use a new output directory for every attempt so earlier evidence remains recoverable.

## 4. Analyze with the current agent

Read the manifest first and inspect every frame. Use `shot-analysis-schema.md` for the result structure. Keep duration-split segments in the same shot group when explaining edits and narrative rhythm. Infer motion by comparing the opening, middle, and closing frames, and label the inference. Do not claim exact dialogue, music, lens focal length, or unseen actions without direct evidence.

If the agent can inspect or transcribe the original video natively, use that capability to improve motion and audio notes. If it cannot, complete the visual analysis and mark audio fields unavailable. Optional transcription software or APIs require the same install/data/cost approval rules.

## 5. Continue creatively

After delivering the factual breakdown, let the user choose:

- Keep the analysis only.
- Rewrite: create a new story while applying the user's requested changes.
- Same-structure remake: preserve timing, shot grammar, camera logic, and rhythm while replacing protected or identifying creative elements unless the user confirms they own or may reproduce them.
- Generate media: use an available video-generation tool or the user's configured provider only after confirming provider, model, estimated charge, and submitted prompt.

Keep original and transformed versions separate. Never silently replace the analysis with a creative rewrite.
