# Three stages so the shipped image carries a server and nothing else: no
# toolchain, no node_modules, no source.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# next build reads .env files when present; the deployed values arrive as real
# environment variables instead, so none is copied in.
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Summary cache, read state and invites. Mounted as a volume in production —
# without one, every deploy would hand out new invite links.
ENV DATA_DIR=/data

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/scripts/invite.mjs ./scripts/invite.mjs

RUN mkdir -p /data && chown -R node:node /data
USER node

EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
