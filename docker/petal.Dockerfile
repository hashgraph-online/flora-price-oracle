# syntax=docker/dockerfile:1.6

FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages ./packages
COPY src ./src
RUN pnpm install --frozen-lockfile --no-optional
RUN pnpm run build

FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY docker/petal.package.json package.json
RUN pnpm install --prod --no-frozen-lockfile --no-optional

FROM node:22-alpine AS petal
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
CMD ["node", "dist/petal.cjs"]
