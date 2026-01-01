# =============================================================================
# Dockerfile for Crafatar API
# =============================================================================
#
# Multi-stage build:
# 1. Builder stage: Install dependencies and compile TypeScript
# 2. Production stage: Minimal runtime image
#
# Build: docker build -t crafatar-api .
# Run:   docker run -p 3000:3000 crafatar-api
# =============================================================================

# =============================================================================
# Stage 1: Builder
# =============================================================================
FROM node:20-alpine AS builder

# Install build dependencies for native modules (canvas, sharp)
RUN apk --no-cache add \
    git \
    python3 \
    make \
    g++ \
    cairo-dev \
    pango-dev \
    jpeg-dev \
    giflib-dev \
    pixman-dev \
    pkgconfig

# Create non-root user for security
RUN adduser -D app
USER app

# Set working directory
WORKDIR /home/app/crafatar

# Copy package files first for better layer caching
COPY --chown=app package.json package-lock.json* ./

# Install all dependencies (including dev dependencies for build)
RUN npm install

# Copy source code and configuration
COPY --chown=app . .

# Build TypeScript
RUN npm run build

# Create image directories
RUN mkdir -p images/faces images/helms images/skins images/renders images/capes

# =============================================================================
# Stage 2: Production
# =============================================================================
FROM node:20-alpine

# Install runtime dependencies for canvas and sharp
RUN apk --no-cache add \
    cairo \
    pango \
    jpeg \
    giflib \
    pixman \
    vips

# Create non-root user
RUN adduser -D app
USER app

# Set working directory
WORKDIR /app

# Create image directories
RUN mkdir -p images/faces images/helms images/skins images/renders images/capes

# Copy built application and production dependencies
COPY --chown=app --from=builder /home/app/crafatar/dist ./dist
COPY --chown=app --from=builder /home/app/crafatar/node_modules ./node_modules
COPY --chown=app --from=builder /home/app/crafatar/package.json ./

# Set production environment
ENV NODE_ENV=production

# Expose the application port
EXPOSE 3000

# Volume for cached images (persists across container restarts)
VOLUME /app/images

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget -q --spider http://localhost:3000/ || exit 1

# Start the application
ENTRYPOINT ["node", "dist/apps/crafatar-api/src/main.js"]