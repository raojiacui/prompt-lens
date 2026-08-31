FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg python3 python3-pip \
  && python3 -m pip install --break-system-packages --no-cache-dir yt-dlp scenedetect-headless \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY workers/ffmpeg-worker/package.json ./package.json
RUN npm install --omit=dev
COPY workers/ffmpeg-worker/server.mjs ./server.mjs
COPY workers/ffmpeg-worker/scene-detect.py ./scene-detect.py

ENV PORT=8080
CMD ["node", "server.mjs"]
