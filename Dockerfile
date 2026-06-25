# Worker-only image. Builds & runs the LiveKit agent (src/agent/worker.ts).
# The frontend + token function deploy to Cloudflare Pages, NOT this image.
#
# Build:  docker build -t lotus-agent .
# Run:    docker run --env-file .env --restart unless-stopped lotus-agent
#
# Must be linux/amd64 so npm pulls @livekit/local-inference-linux-x64.
# On an arm64 machine (Apple Silicon): docker build --platform linux/amd64 ...
FROM node:20-slim

WORKDIR /app

# Install deps first for layer caching. Full install (not --omit=dev): the worker
# runs via `tsx`, which is a devDependency. The install also pulls the native
# local-inference binary (VAD + turn detection) for this platform.
COPY package.json package-lock.json* ./
RUN npm install

# Worker source only — frontend/eval/tests aren't needed at runtime.
COPY tsconfig.json ./
COPY src ./src

# `start` = production mode (no hot reload). Env (LIVEKIT_*, DEEPGRAM_API_KEY,
# GOOGLE_API_KEY, OPENROUTER_API_KEY) injected at run time via --env-file.
CMD ["npx", "tsx", "src/agent/worker.ts", "start"]
