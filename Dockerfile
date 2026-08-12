# Debian rather than Alpine: @libsql/client loads a native binding, and the
# musl build is the one that tends to be missing for a given platform.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# next build reads .env files when present; the deployed values arrive as real
# environment variables instead, so none is copied in.
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

USER node

# Render supplies PORT; this is the fallback for a plain docker run.
ENV PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["node", "server.js"]
