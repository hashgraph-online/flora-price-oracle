# syntax=docker/dockerfile:1.6

FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS builder
RUN apk add --no-cache --virtual .build-deps build-base python3 make g++ bash curl && \
  corepack enable && corepack prepare pnpm@10.19.0 --activate
COPY dashboard/package.json ./
RUN pnpm install --no-frozen-lockfile
COPY dashboard .
RUN pnpm run build
RUN pnpm prune --prod && apk del .build-deps

FROM base AS runner
RUN apk add --no-cache dumb-init
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3100
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3100
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
