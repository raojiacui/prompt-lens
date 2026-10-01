# EasyDown local browser prototype

This is an isolated, single-link experiment, not the production resolver. It does not read API keys, call the paid API, retry parsing, bypass verification, or upload files to storage. Website automation is subject to the provider's service limits; do not use this as a high-volume commercial backend without permission.

Requires local Google Chrome and the project's installed Playwright dependency.

```powershell
node scripts/easydown-web-download.mjs "https://www.douyin.com/video/7673851043746221352"
```

The script fills the public link and submits once if the button becomes enabled. It chooses a recognizable higher-resolution video, preferring an explicitly labeled video with sound. For a video-only option, it also chooses the highest labeled audio bitrate. Files and failure screenshots are saved under the ignored `.data/easydown-web/` directory. Separate video and audio files still require merging; this script does not perform the storage, shot detection, or analysis stages.

Challenges, refusals, rate limits, unrecognized results, and browser download failures stop the run. It does not automatically solve a challenge. Some sites open media in a new tab instead of triggering a browser download; that behavior is not supported by this prototype.

## Verification

```powershell
node --test scripts/easydown-web-download.check.mjs
```

The three local tests cover URL validation and media selection, not the provider's live page. A live run on 2026-10-01 filled the supplied Douyin URL, but the Download button stayed disabled for the click timeout. No parse was submitted and no media was downloaded. Therefore live end-to-end functionality has **not** been verified.
