# Prompt Lens FFmpeg Worker

Cloud Run worker for V2 video breakdown.

## Endpoints

- `GET /healthz`
- `POST /breakdown`
- `POST /resolve-media`

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


`/resolve-media` resolves a supported social video link, downloads it in the worker, uploads the resulting MP4 to R2, and returns the stored media URL for the main app analysis flow.

Supported pasted-link platforms:

- YouTube: `youtube.com`, `youtu.be`
- TikTok: `tiktok.com`
- Douyin: `douyin.com`, `iesdouyin.com`, `amemv.com`

Request:

```json
{ "url": "https://www.youtube.com/watch?v=..." }
```

Response:

```json
{
  "mediaUrl": "https://.../linked-media/youtube/<id>.mp4",
  "storageKey": "linked-media/youtube/<id>.mp4",
  "mediaType": "video",
  "platform": "youtube",
  "metadata": { "duration": 9.2, "width": 1080, "height": 1920, "fps": 30, "hasAudio": true },
  "filename": "youtube-linked-video.mp4"
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
YTDLP_PATH=yt-dlp
MAX_RESOLVE_SECONDS=600
```

## App-side KIE analysis

The main Next app uses KIE for scene blueprint analysis. Configure KIE_AI_API_KEY or save a user KIE key in Settings. Optional app-side overrides: KIE_ANALYSIS_MODEL and KIE_ANALYSIS_ENDPOINT.


## Local development

From the project root, run:

`powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-local-ffmpeg-worker.ps1
` 

The script loads .env.local, derives R2_ENDPOINT from R2_ACCOUNT_ID when needed, and serves http://localhost:8080.

The Dockerfile installs `yt-dlp` for `/resolve-media`. TikTok and Douyin availability can vary by region, anti-bot checks, or expired share links; if production links fail, deploy the worker in a reachable region and consider adding cookie/proxy handling later.
