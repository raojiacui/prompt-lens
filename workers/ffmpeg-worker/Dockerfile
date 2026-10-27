FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg python3 python3-pip \
  && python3 -m pip install --break-system-packages --no-cache-dir scenedetect-headless \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY workers/ffmpeg-worker/package.json ./package.json
RUN npm install --omit=dev
COPY workers/ffmpeg-worker/server.mjs ./server.mjs
COPY workers/ffmpeg-worker/reconciliation-scheduler.mjs ./reconciliation-scheduler.mjs
COPY workers/ffmpeg-worker/fly-machine-lifecycle.mjs ./fly-machine-lifecycle.mjs
COPY workers/ffmpeg-worker/parallel-download.mjs ./parallel-download.mjs
COPY workers/ffmpeg-worker/media-fetch.mjs ./media-fetch.mjs
COPY workers/ffmpeg-worker/storage-media-url.mjs ./storage-media-url.mjs
COPY workers/ffmpeg-worker/video-inspection.mjs ./video-inspection.mjs
COPY workers/ffmpeg-worker/remote-video-codec.mjs ./remote-video-codec.mjs
COPY workers/ffmpeg-worker/scene-segments.mjs ./scene-segments.mjs
COPY workers/ffmpeg-worker/scene-detect.py ./scene-detect.py

ENV PORT=8080
CMD ["node", "server.mjs"]
