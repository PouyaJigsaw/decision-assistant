FROM node:22-bookworm-slim
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/domain ./packages/domain
COPY apps/api ./apps/api

RUN pnpm install --frozen-lockfile

ENV HOST=0.0.0.0
ENV PORT=8080
EXPOSE 8080

CMD ["pnpm", "--filter", "@decision-assistant/api", "start"]
