FROM node:20-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Optional ASR: pip install faster-whisper (CPU) — uncomment for full pipeline
# RUN pip3 install --break-system-packages faster-whisper numpy

COPY package.json package-lock.json* ./
COPY packages/shared ./packages/shared
COPY apps/worker ./apps/worker
COPY scripts ./scripts
COPY refs ./refs

RUN npm ci --workspace=@video-transcriber/worker --workspace=@video-transcriber/shared \
  && npm run build --workspace=@video-transcriber/shared \
  && npm run build --workspace=@video-transcriber/worker

ENV NODE_ENV=production
WORKDIR /app/apps/worker
CMD ["node", "dist/index.js"]
