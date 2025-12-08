# syntax=docker/dockerfile:1.6

FROM node:22-bullseye

WORKDIR /workspace

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/* && \
    corepack enable && \
    corepack prepare pnpm@10.19.0 --activate

# Code is mounted at runtime for hot reload; default command gets overridden by docker compose.
CMD ["pnpm", "run", "dev"]
