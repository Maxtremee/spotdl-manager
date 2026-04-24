# Production Dockerfile — Node runtime + ffmpeg + sqlite3 (Phase 2 adds Python + spotifyscraper; Phase 3 adds yt-dlp)
# Multi-stage build for optimized image size

# Stage 1: Dependencies and Build
FROM node:22-slim
WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3-dev \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install all dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# Copy application source
COPY . .

# Run panda codegen and build
RUN pnpm prepare && pnpm build

# Prune dev dependencies
RUN pnpm install --prod --frozen-lockfile

# Stage 2: Production Runtime
FROM node:22-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    sqlite3 \
    python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Set working directory
WORKDIR /app

# Copy production dependencies from builder
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.output ./.output
COPY --from=builder --chown=node:node /app/package.json ./package.json

# Copy drizzle migrations and config
COPY --chown=node:node drizzle ./drizzle
COPY --chown=node:node drizzle.config.ts ./drizzle.config.ts

# Create data directory with proper permissions
RUN mkdir -p /app/data/logs /app/data/sync /app/data/daily-mix \
    && chown -R node:node /app/data

# Create directory for database with proper permissions
RUN chown -R node:node /app

# Phase 2 pivot (2026-04-24): spotifyscraper replaces spotdl — no browser engine required.
# Phase 2: Python scraper — spotifyscraper venv baked into immutable layer.
# chown node:node so the non-root runtime user cannot modify the interpreter
# post-build (T-2-07 TOCTOU mitigation). Binary path fixed at
# /app/scraper/.venv/bin/python and referenced by SpotifyScraperBridge.
COPY --chown=node:node scraper ./scraper
RUN python3 -m venv /app/scraper/.venv \
    && /app/scraper/.venv/bin/pip install --no-cache-dir -r /app/scraper/requirements.txt \
    && chown -R node:node /app/scraper

# Switch to non-root user
USER node

# Expose production port
EXPOSE 3000

# Set production environment
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["pnpm", "start"]
