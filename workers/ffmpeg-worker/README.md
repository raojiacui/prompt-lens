# Prompt Lens FFmpeg Worker

Cloud Run worker for V2 video breakdown.

## Endpoints

- `GET /healthz`
- `POST /breakdown`

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

## Environment

```text
WORKER_SECRET=
R2_ENDPOINT=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_PUBLIC_URL=
SCENE_THRESHOLD=0.32
MAX_SCENE_SECONDS=8
MIN_SCENE_SECONDS=0.6
```

## App-side KIE analysis

The main Next app uses KIE for scene blueprint analysis. Configure KIE_AI_API_KEY or save a user KIE key in Settings. Optional app-side overrides: KIE_ANALYSIS_MODEL and KIE_ANALYSIS_ENDPOINT.

