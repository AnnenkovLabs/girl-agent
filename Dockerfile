# girl-agent — multi-arch (amd64, arm64) container.
#
# Usage:
#   docker run -it --rm -v girl-agent-data:/data ghcr.io/thesashadev/girl-agent:latest
#   docker run -d --name girl-agent --restart=unless-stopped \
#     -v girl-agent-data:/data \
#     -e GIRL_AGENT_DATA=/data \
#     -e GIRL_AGENT_MODE=bot \
#     -e GIRL_AGENT_TOKEN=... \
#     ghcr.io/thesashadev/girl-agent:latest \
#     server --headless

# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN npm run build

# ---- runtime stage (small) ----
FROM node:22-alpine
LABEL org.opencontainers.image.source="https://github.com/TheSashaDev/girl-agent"
LABEL org.opencontainers.image.title="girl-agent"
LABEL org.opencontainers.image.description="AI girl for Telegram (MTProto / Bot API)"
LABEL org.opencontainers.image.licenses="MIT"

# Non-root user.
RUN addgroup -S app && adduser -S -G app -h /home/app app

WORKDIR /home/app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY --from=build /app/dist ./dist

# Profiles live in /data (volume-mountable).
RUN mkdir -p /data && chown -R app:app /data /home/app
ENV GIRL_AGENT_DATA=/data
VOLUME ["/data"]

USER app
ENTRYPOINT ["node", "/home/app/dist/cli.js"]
CMD []
