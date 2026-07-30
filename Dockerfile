FROM node:24-slim AS build

RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Build with the complete toolchain, but do not carry it into the runtime image.
COPY package*.json ./
RUN npm ci --no-audit

COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:24-slim AS runtime

RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# The runtime and migration jobs need Prisma and tsx, now classified as
# production dependencies. Lint, test, and frontend build tools stay behind.
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev --no-audit \
    && npx prisma generate \
    && npm audit --omit=dev --audit-level=high \
    && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY server.ts tsconfig.json ./
COPY server ./server
COPY lib ./lib
COPY scripts ./scripts

RUN mkdir -p /app/data

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/app/data/db.json

# Schema changes run in the controlled pre-deploy Cloud Run migration job.
# The service container never mutates its database schema during startup.
CMD ["node", "--import", "tsx", "server.ts"]
