# syntax=docker/dockerfile:1.6

FROM node:22-alpine

WORKDIR /workspace

RUN apk add --no-cache libc6-compat && \
  corepack enable && \
  corepack prepare pnpm@10.19.0 --activate

# Code is mounted at runtime for hot reload; default command gets overridden by docker compose.
CMD ["pnpm", "run", "dev"]
