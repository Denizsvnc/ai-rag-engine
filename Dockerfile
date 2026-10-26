# ==============================================================================
# Stage 1: Build & Compile TypeScript
# ==============================================================================
FROM node:22-slim AS builder

WORKDIR /app

# Install build dependencies
COPY package*.json tsconfig.json ./
RUN npm ci

# Copy source code and default data assets
COPY src/ ./src/

# Compile TypeScript types and bundle production JavaScript
RUN npm run build

# ==============================================================================
# Stage 2: Minimal Production Runtime
# ==============================================================================
FROM node:22-slim AS runner

WORKDIR /app

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Install runtime utilities: curl (for healthcheck) and dumb-init (proper signal handling)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    dumb-init \
    && rm -rf /var/lib/apt/lists/*

# Install production-only dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built code from builder stage
COPY --from=builder /app/dist ./dist

# Copy seed data and configuration utilities
COPY src/utils/*.json ./src/utils/

# Prepare directories for persistence and set non-root permissions
RUN mkdir -p /app/data /app/src/utils && \
    chown -R node:node /app

# Run as non-privileged user for enterprise security
USER node

# Expose HTTP API port
EXPOSE 3000

# Docker healthcheck targeting /api/health
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

# Process supervisor
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Launch application
CMD ["node", "dist/api/server.js"]
