# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# Copy source files. `ee/` is the commercial code (see ENTERPRISE-PATHS.md);
# it is compiled alongside src/ here because this image is our own SaaS build.
# An open-core image omits this COPY — nothing in src/ imports from it.
COPY tsconfig.json ./
COPY src ./src
COPY ee ./ee
COPY @types ./@types
COPY skills ./skills
COPY tailwind.config.js ./

# Build TypeScript + Tailwind CSS. postbuild copies src/public, src/templates
# and skills/ into dist/, which mirrors the repo root.
RUN yarn build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy package files and install production dependencies only
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production && \
    yarn cache clean

# Copy built files from builder stage. Agent Skills are static files served by
# registerPlugins; they are not compiled, so `postbuild` copies them into dist/
# as-is and they arrive with everything else.
COPY --from=builder /app/dist ./dist

# Set ownership to non-root user
RUN chown -R nodejs:nodejs /app

USER nodejs

# Expose port (Railway will set PORT env var)
EXPOSE 3050

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-3050}/health || exit 1

# Start the application
CMD ["node", "dist/src/index.js"]
