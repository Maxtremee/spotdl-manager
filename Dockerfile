# Production Dockerfile with spotdl and all dependencies
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
    python3 \
    python3-pip \
    ffmpeg \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# Install spotdl
RUN pip3 install --no-cache-dir spotdl

# Verify spotdl installation
RUN spotdl --version

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
