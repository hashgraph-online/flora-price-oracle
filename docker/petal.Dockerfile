# syntax=docker/dockerfile:1.6

FROM node:22-alpine
WORKDIR /app
ENV CI=1
RUN apk add --no-cache --virtual .build-deps python3 make g++
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages ./packages
COPY src ./src
RUN pnpm install --frozen-lockfile --no-optional
RUN pnpm run build
RUN pnpm prune --prod
RUN apk del .build-deps
ENV NODE_ENV=production
CMD ["node", "dist/petal.cjs"]
