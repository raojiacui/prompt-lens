# Prompt Lens FFmpeg Worker

Cloud Run worker for V2 video breakdown. Scene boundary detection uses PySceneDetect first, then falls back to FFmpeg scene filtering if PySceneDetect is unavailable or fails.

## Endpoints

- `GET /healthz`
- `POST /breakdown`
- `POST /ingest-media`

`/breakdown` requires:

```http
Authorization: Bearer <WORKER_SECRET>
Content-Type: application/json
```

Request:

```json
{ "videoUrl": "https://signed-download-url" }
```

Response:

```json
{
  "metadata": { "duration": 32.5, "width": 1920, "height": 1080, "fps": 30, "hasAudio": true },
  "scenes": [
    {
      "sceneIndex": 1,
      "startTime": 0,
      "endTime": 4.2,
      "duration": 4.2,
      "shotGroupId": "shot-001",
      "clipUrl": "https://.../clip.mp4",
      "keyframeUrls": ["https://.../keyframe.jpg"],
      "audioUrl": "https://.../audio.m4a",
      "transitionIn": "start",
      "transitionOut": "hard_cut"
    }
  ]
}
```


`/ingest-media` receives media URLs already resolved by the app's video-link provider, downloads them, optionally merges a separate audio stream, uploads the resulting MP4 to R2, and returns the stored media URL for the analysis flow. It accepts optional `videoHeaders` and `audioHeaders` for public media-host headers such as `Referer`.

Separate video and audio streams download concurrently. Uploads stream from disk rather than buffering the entire file in memory. Media ingest downloads and uploads are canceled on client disconnect or after 210 seconds, before the app's 240-second timeout. Stage logs identify download, merge, inspection and upload durations without logging temporary media URLs or secrets. Network throughput still depends on the media host and worker region.

Supported pasted-link platforms:

- TikTok
- Douyin
- Bilibili

Request:

```json
{
  "platform": "bilibili",
  "videoUrl": "https://temporary-provider-video-url",
  "audioUrl": "https://optional-separate-audio-url",
  "filename": "bilibili-linked-video.mp4"
}
```

Response:

```json
{
  "mediaUrl": "https://.../linked-media/bilibili/<id>.mp4",
  "storageKey": "linked-media/bilibili/<id>.mp4",
  "mediaType": "video",
  "platform": "bilibili",
  "metadata": { "duration": 9.2, "width": 1080, "height": 1920, "fps": 30, "hasAudio": true },
  "filename": "bilibili-linked-video.mp4"
}
```
## Environment

```text
WORKER_SECRET=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_PUBLIC_URL=
SCENE_THRESHOLD=0.32
MAX_SCENE_SECONDS=8
MIN_SCENE_SECONDS=0.6
PYSCENEDETECT_ENABLED=true
PYSCENEDETECT_DETECTOR=adaptive
PYSCENEDETECT_THRESHOLD=27
PYSCENEDETECT_ADAPTIVE_THRESHOLD=3
PYTHON_PATH=python3
PYSCENEDETECT_SCRIPT_PATH=/app/scene-detect.py
MAX_RESOLVE_SECONDS=600
MAX_RESOLVE_BYTES=1073741824
```

## App-side KIE analysis

The main Next app uses KIE for scene blueprint analysis. Configure KIE_AI_API_KEY or save a user KIE key in Settings. Optional app-side overrides: KIE_ANALYSIS_MODEL and KIE_ANALYSIS_ENDPOINT.


## Local development

From the project root, run:

`powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-local-ffmpeg-worker.ps1
` 

The script loads .env.local, derives R2_ENDPOINT from R2_ACCOUNT_ID when needed, and serves http://localhost:8080.

Set `FFMPEG_WORKER_URL=http://localhost:8080` in `.env.local` to use the local worker instead of a deployed version. The local startup script disables the commercial reconciliation scheduler, even if production scheduler settings exist in `.env.local`.

The Dockerfile installs `scenedetect-headless` for `/breakdown`. Social-platform extraction is handled by the configured provider in the main app; this worker never receives the provider API key.

## Scene detection evaluation

The adaptive detector uses `PYSCENEDETECT_ADAPTIVE_THRESHOLD` (default 3),
`PYSCENEDETECT_MIN_CONTENT_VAL` (default 15), and
`PYSCENEDETECT_WINDOW_WIDTH` (default 2). The regular
`PYSCENEDETECT_THRESHOLD` (default 27) only applies to the content detector.
Commercial preview metadata includes `sceneDetection.provider` and
`sceneDetection.detector` so fallback results can be distinguished from PySceneDetect.

For local evaluation, install `scenedetect-headless` in an isolated Python environment
and run from the repository root:

```powershell
python scripts/scene-detection-benchmark.py --project path/to/markers.mlt --output tmp/scene-evaluation/report.json
python scripts/scene-detection-benchmark.py --project path/to/markers.mlt --output tmp/scene-evaluation/refinement.json --suite refinement
python tests/scene-detection-benchmark.test.py
```

The Shotcut project must contain one untrimmed, normal-speed video at timeline zero
with point markers. The video resource is resolved relative to the project file.
Each detection can match at most one marker, within 0.5 seconds by default.
The report includes missed and extra cuts, signed timing offsets, and a temporal
holdout (last third) excluded from parameter selection. A temporal holdout from
one video is not independent-video validation or model training.
These commands read the source files without uploading them or changing runtime
defaults. Keep sample videos, marked projects, environments, and generated reports
outside feature commits; the repository's `tmp/` directory is ignored.

### Neural detector comparison (offline only)

`scripts/neural-scene-benchmark.py` loads upstream TransNet V2, AutoShot, or
OmniShotCut architectures with an explicitly supplied checkpoint. Install CPU
PyTorch, torchvision, numpy, OpenCV, einops, huggingface-hub, and ffmpeg-python
in an isolated environment, with FFmpeg on PATH. Clone the upstream repositories
outside tracked source. No model or dependency is added to the deployed worker.

```powershell
python scripts/neural-scene-benchmark.py --model transnet --project path/to/markers.mlt --repo tmp/models/TransNetV2 --checkpoint path/to/weights.pth --output tmp/scene-evaluation/transnet.json --baseline tmp/scene-evaluation/report.json
python scripts/neural-scene-benchmark.py --model autoshot --project path/to/markers.mlt --repo tmp/models/AutoShot --checkpoint path/to/ckpt_0_200_0.pth --output tmp/scene-evaluation/autoshot.json --baseline tmp/scene-evaluation/report.json
python scripts/neural-scene-benchmark.py --model omni --project path/to/markers.mlt --repo tmp/models/OmniShotCut --checkpoint path/to/OmniShotCut_ckpt.pth --output tmp/scene-evaluation/omni.json --baseline tmp/scene-evaluation/report.json
python tests/neural-scene-benchmark.test.py
```

Checkpoints are loaded with `weights_only=True` and strict architecture matching;
OmniShotCut additionally allows its saved `argparse.Namespace`. Strict matching
does not establish checkpoint provenance: record the source URL and immutable
revision separately, especially for community-converted or mirrored weights.
Reports record the architecture Git revision and checkpoint SHA-256. Do not use
an unreviewed repository with executable model code.

TransNet V2 and AutoShot use upstream 100-frame RGB windows at 48x27 resolution,
25-frame edge padding, stride 50, and center 50-frame outputs. Both point and
transition-span prediction heads are evaluated. Consecutive threshold-positive
frames become one midpoint cut; the first result is the default point head
(TransNet V2 threshold 0.5, AutoShot 0.296). Threshold selection uses only the
first two thirds; keep the last third and additional videos for validation.

The OmniShotCut adapter runs CPU tensors with the upstream validation transform,
window decoder, and 10-frame overlap. Its complete checkpoint replaces backbone
weights, so downloading a separate ImageNet checkpoint is disabled. Results
include raw labeled boundaries, general-shot starts, and an experimental
transition-midpoint interpretation excluding padding. These interpretations are
not interchangeable with interval-based scores in the paper.

An optional baseline report enables a **cached simulation**: retain first-pass
cuts, and add candidates only inside shots longer than 15 seconds, at least
0.6 seconds from existing cuts. This neither forces 15-second cuts nor measures
cropped second-pass latency. `consensus_cuts` permits one vote per model and
requires two agreeing models; ensemble experiments must use thresholds fixed
before evaluating held-out data.

TransVLM's official inference requires Python 3.12 and CUDA. It is not supported
by this CPU benchmark. Do not substitute published scores for a local test or
silently rent GPU resources. Source videos and annotations stay local; all
weights, frame caches, and generated reports belong in ignored directories.
