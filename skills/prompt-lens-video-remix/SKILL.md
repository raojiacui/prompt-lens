---
name: prompt-lens-video-remix
description: Analyze a user-provided reference video locally, detect shots, extract representative frames, reverse-engineer generation prompts, and optionally rewrite the concept or create a remake plan. Use when the user asks to break down, reverse-prompt, rewrite, or recreate a video; do not use for ordinary playback or unrelated writing.
---

# Prompt Lens Video Remix

Turn a reference video into an editable shot plan and generation-ready prompts while keeping media local by default.

## Operating rules

- Prefer the current agent's native visual and reasoning capabilities. Offer a user-selected API only when native capability is insufficient.
- Never install software, download a linked video, upload media, call a paid API, or start video generation without telling the user what will happen and obtaining approval for that action.
- Never request an API key in chat or write one into project files. Use the agent's secret store or a provider-standard environment variable configured by the user.
- Operate only on the media the user identified. Do not bypass DRM, authentication, private access, paywalls, or platform controls.
- Keep generated frames and reports in a new user-visible output directory. Do not overwrite or delete existing files.

## Workflow

1. Read [references/workflow.md](references/workflow.md) and select the local-file or link-input path.
2. Run `python scripts/check_environment.py`. If a required dependency is missing, explain why it is needed and ask before installing it. Do not run an installer yourself without approval.
3. Resolve the input to a local media file. For link handling, follow the boundaries in `references/workflow.md`.
4. Run:

   ```text
   python scripts/prepare_video.py INPUT --output OUTPUT_DIRECTORY
   ```

   This produces `manifest.json`, `storyboard.md`, and three representative frames per detected scene. If scene detection is noisy, adjust `--scene-threshold` within `0.20` to `0.50` and rerun into a different empty directory.
5. Read `manifest.json`, then inspect every extracted frame. Analyze each scene with [references/shot-analysis-schema.md](references/shot-analysis-schema.md). Treat motion, sound, dialogue, identity, and off-frame events as uncertain unless the available evidence supports them.
6. Present the overall structure, shot table, and generation prompts before proposing further action.
7. Ask whether the user wants to keep the analysis, rewrite a new story, or create a same-structure remake. For either creative branch, read [references/prompt-and-remix-guide.md](references/prompt-and-remix-guide.md).
8. Generate actual media only when the user explicitly asks and confirms the selected tool/provider and any cost.

## Completion standard

Deliver a concise overall reading plus a complete scene-by-scene result with timestamps, visual evidence, camera and motion notes, confidence labels, and a standalone generation prompt for each scene. Preserve the original analysis alongside any rewritten version so the user can compare them.
