# Stage 1: builder
FROM oven/bun:1.3-alpine AS builder

WORKDIR /app

# Copy full workspace for monorepo
COPY package.json bun.lock tsconfig.json ./
COPY packages ./packages

RUN bun install --frozen-lockfile

# Build all packages
RUN bun run build

# Stage 2: runtime
FROM oven/bun:1.3-alpine

# Install curl for HEALTHCHECK
RUN apk add --no-cache curl

# Create non-root user (no hardcoded UID — Alpine assigns next available)
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy only production dependencies from builder
COPY package.json bun.lock ./
COPY packages ./packages
RUN bun install --frozen-lockfile --production

USER appuser

# Expose dashboard port (18678 per server config)
EXPOSE 18678

# Health check using curl
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD curl -f http://localhost:18678/health || exit 1

# Default command
CMD ["bun", "run", "src/server.ts"]
