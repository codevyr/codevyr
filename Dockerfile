# -------- Base builder image
FROM node:26-slim AS deps
WORKDIR /app

# Install only dependencies (better layer caching)
COPY package.json package-lock.json* ./
RUN npm ci

# -------- Build stage
FROM node:26-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build the app to standalone output
RUN npm run build

# -------- Production runtime
FROM node:26-slim AS runner
WORKDIR /app

# Create non-root user
RUN groupadd -g 1001 nodejs && useradd -m -u 1001 -g nodejs nextjs

# Install wget for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends wget && rm -rf /var/lib/apt/lists/*

# The runtime only runs `node server.js` (deps are baked into .next/standalone);
# the bundled npm CLI is never invoked here and its vendored deps
# (tar/undici/brace-expansion) are the only fixable CVEs in the image. Drop it.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Copy the standalone server and required assets
# .next/standalone contains node_modules and a self-contained server.js
COPY --from=builder /app/.next/standalone ./
# Static assets are outside the standalone dir
COPY --from=builder /app/.next/static ./.next/static
# Public assets (if any)
COPY --from=builder /app/public ./public
COPY docker-entrypoint.sh /app/docker-entrypoint.sh

RUN chmod 755 /app/docker-entrypoint.sh \
  && chown -R nextjs:nodejs /app/public

# Drop privileges
USER nextjs

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ || exit 1

CMD ["/app/docker-entrypoint.sh"]
