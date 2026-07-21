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
ENV HOSTNAME=0.0.0.0

# Ferramentas de limpeza de metadados (open-source, gratuitas)
RUN apt-get update \
    && apt-get install -y --no-install-recommends libimage-exiftool-perl ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copia o build standalone do Next.js
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Modelo do NudeNet embutido (censura por IA in-process, sem serviço externo).
# O tracing do Next não copia arquivos de dados soltos, então copiamos à mão.
COPY --from=builder /app/models ./models

# Diretório de dados (banco SQLite + mídia). Monte um VOLUME PERSISTENTE aqui
# no EasyPanel, senão o conteúdo é perdido a cada deploy.
# O container roda como root para poder escrever no volume (que o EasyPanel
# cria como root) e vincular a porta padrão — é um app de uso próprio na sua
# própria VPS.
RUN mkdir -p /app/data
VOLUME ["/app/data"]
ENV MEDIA_STORAGE_DIR=/app/data

EXPOSE 3000

CMD ["node", "server.js"]
