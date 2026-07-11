# =========================================================================
# Hot Dash - Dockerfile (otimizado para EasyPanel / Hostinger)
# Build multi-stage: instala deps -> builda -> imagem final enxuta.
# A imagem final inclui exiftool + ffmpeg para o Módulo de Limpeza de Metadados.
# =========================================================================

# ---- Stage 1: dependências ----
FROM node:22-slim AS deps
WORKDIR /app
# Ferramentas para compilar módulos nativos (fallback do better-sqlite3).
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci

# ---- Stage 2: build ----
FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Variáveis NEXT_PUBLIC_* são embutidas no build; o EasyPanel as injeta aqui.
RUN npm run build

# ---- Stage 3: runner (produção) ----
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Ferramentas de limpeza de metadados (open-source, gratuitas)
RUN apt-get update \
    && apt-get install -y --no-install-recommends libimage-exiftool-perl ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Usuário não-root
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

# Copia o build standalone do Next.js
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Diretório de dados (mídia). Monte um VOLUME PERSISTENTE aqui no EasyPanel,
# senão o conteúdo é perdido a cada deploy.
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data
VOLUME ["/app/data"]
ENV MEDIA_STORAGE_DIR=/app/data

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
