# syntax=docker/dockerfile:1.6

# ── 依赖阶段：仅安装生产依赖 ──
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ── 运行阶段 ──
FROM node:20-alpine
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

# 仅拷贝运行所需文件
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server.js ai-engine.js validate.js ./
COPY config ./config
COPY public ./public

# 用非 root 用户运行
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/ >/dev/null || exit 1

CMD ["node", "server.js"]
