# -------- Base builder image
FROM node:18-alpine AS deps
# Optional: needed for some native modules like sharp
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install only dependencies (better layer caching)
COPY package.json package-lock.json* ./
RUN npm ci

# -------- Build stage
FROM node:18-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build the app to standalone output
RUN npm run build

# -------- Production runtime
FROM node:18-alpine AS runner
WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

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

# Drop privileges
USER nextjs

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ || exit 1

CMD ["node", "server.js"]