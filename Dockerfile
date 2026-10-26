FROM node:24-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
COPY guidance ./guidance
RUN pnpm exec tsx src/rag/warm-embedder.ts
# Long polling: no inbound port needed. Migrations run before the bot starts.
CMD ["sh", "-c", "pnpm db:migrate && pnpm start"]
