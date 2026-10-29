FROM node:24-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
COPY guidance ./guidance
RUN pnpm exec tsx src/rag/warm-embedder.ts
# Long polling: no inbound port needed. Migrations and the guidance index are brought up to date
# before the bot starts, so adding a guide is a commit and a deploy.
CMD ["sh", "-c", "pnpm db:migrate && pnpm ingest && pnpm start"]
