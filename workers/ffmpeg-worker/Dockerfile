FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY workers/ffmpeg-worker/package.json ./package.json
RUN npm install --omit=dev
COPY workers/ffmpeg-worker/server.mjs ./server.mjs

ENV PORT=8080
CMD ["node", "server.mjs"]
