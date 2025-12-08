# syntax=docker/dockerfile:1.6

FROM node:24-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
RUN corepack enable
COPY package.json pnpm-lock.yaml tsconfig.json ./
COPY pnpm-workspace.yaml ./
COPY packages ./packages
COPY src ./src
RUN pnpm install --frozen-lockfile --no-optional
RUN pnpm run build
RUN pnpm prune --prod

FROM node:24-alpine AS consumer
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
EXPOSE 3000
CMD ["node", "dist/consumer.cjs"]
