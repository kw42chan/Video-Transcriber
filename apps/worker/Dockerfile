FROM node:20-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    bubblewrap \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN npm install --global npm@11.21.1

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

RUN mkdir -p /tmp/vt-jobs /opt/whisper-models && chown -R node:node /tmp/vt-jobs /opt/whisper-models
ENV NODE_ENV=production HF_HOME=/opt/whisper-models
USER node
WORKDIR /app/apps/worker
CMD ["node", "dist/index.js"]
