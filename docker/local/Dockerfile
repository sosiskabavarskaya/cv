# Local development only: one workspace image shared by all application services.
FROM oven/bun:1.3.13 AS bun
FROM node:24.18.0-bookworm-slim AS node
FROM mcr.microsoft.com/playwright:v1.61.1-noble

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY --from=node /usr/local/bin/node /usr/local/bin/node
RUN ln -sf /usr/local/bin/bun /usr/local/bin/bunx \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client tini \
    && rm -rf /var/lib/apt/lists/*

ENV NX_DAEMON=false \
    NEXT_TELEMETRY_DISABLED=1 \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /workspace
COPY --chown=pwuser:pwuser . .
RUN chown pwuser:pwuser /workspace
USER pwuser
RUN bun install --frozen-lockfile
RUN bunx nx run-many -t build \
    --projects=application-registry-api,application-registry-management,application-registry-pdf-worker,facts-authoring,color-scheme \
    --parallel=2

ENTRYPOINT ["/usr/bin/tini", "--"]
