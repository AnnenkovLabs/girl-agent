# manager-agent — multi-arch (amd64, arm64) container.
# Форк @thesashadev/girl-agent, переименованный в @thesashadev/manager-agent.
#
# Usage:
#   docker run -it --rm -p 3100:3100 -v manager-agent-data:/data ghcr.io/shxpe0x/manager-agent:latest
#   docker run -d --name manager-agent --restart=unless-stopped \
#     -v manager-agent-data:/data \
#     -e MANAGER_AGENT_DATA=/data \
#     -e MANAGER_AGENT_MODE=bot \
#     -e MANAGER_AGENT_TOKEN=... \
#     ghcr.io/shxpe0x/manager-agent:latest \
#     server --headless --config /data/bot.json

# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN apk add --no-cache python3 make g++ \
    && npm ci --no-audit --no-fund
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
COPY webui ./webui
RUN npm run build

# ---- runtime stage (small) ----
FROM node:22-alpine
LABEL org.opencontainers.image.source="https://github.com/shxpe0x/girl-agent-manager"
LABEL org.opencontainers.image.title="manager-agent"
LABEL org.opencontainers.image.description="AI-менеджер в Telegram. Форк @thesashadev/girl-agent."
LABEL org.opencontainers.image.licenses="SEE LICENSE IN LICENSE"

# Non-root user.
RUN addgroup -S app && adduser -S -G app -h /home/app app

WORKDIR /home/app
COPY package.json package-lock.json* ./
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
    && npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force \
    && apk del .build-deps

COPY --from=build --chown=app:app /app/dist ./dist

# Profiles live in /data (volume-mountable).
RUN mkdir -p /data && chown -R app:app /data /home/app
ENV MANAGER_AGENT_DATA=/data
ENV MANAGER_AGENT_HOST=0.0.0.0
VOLUME ["/data"]
EXPOSE 3100

USER app
ENTRYPOINT ["node", "/home/app/dist/cli.js"]
CMD []
