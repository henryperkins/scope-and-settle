FROM node:24.15.0-bookworm-slim AS build
WORKDIR /opt/scope-and-settle/app
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@10.34.5
COPY app/package.json app/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY app/ ./
COPY JUDGING.md ../JUDGING.md
# Build stage only: the public configuration template that a test reads. Not copied to the runtime image.
COPY .env.example ../.env.example
COPY deploy/gcp/webhook-lookup.mjs ../deploy/gcp/webhook-lookup.mjs
# Exact public evaluation inputs needed by the build-stage tests, excluded from runtime.
COPY fixtures/scope-held-out-cases.json fixtures/scope-baseline-cases.json ../fixtures/
COPY docs/verification/scope-evaluation-contract.json docs/verification/scope-evaluation-case-notes.json ../docs/verification/
ARG PUBLIC_BASE_URL=https://scope-and-settle.hperkins.com
ARG SOURCE_COMMIT
ENV PUBLIC_BASE_URL=$PUBLIC_BASE_URL SOURCE_COMMIT=$SOURCE_COMMIT
RUN pnpm test
RUN pnpm package:plugin

# Production dependencies only: the frozen lockfile's runtime closure (the MCP SDK), no dev packages and no
# install scripts beyond pnpm.onlyBuiltDependencies.
FROM node:24.15.0-bookworm-slim AS deps
WORKDIR /opt/scope-and-settle/app
RUN npm install --global pnpm@10.34.5
COPY app/package.json app/pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM node:24.15.0-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 SCOPE_SETTLE_DATA_DIR=/var/data
WORKDIR /opt/scope-and-settle/app
RUN mkdir -p /var/data && chown node:node /var/data
COPY --from=build /opt/scope-and-settle/app/dist ./dist
COPY --from=build /opt/scope-and-settle/app/web ./web
COPY --from=build /opt/scope-and-settle/app/scripts ./scripts
COPY --from=build /opt/scope-and-settle/app/package.json ./package.json
COPY --from=deps /opt/scope-and-settle/app/node_modules ./node_modules
COPY --from=build /opt/scope-and-settle/app/downloads ./downloads
COPY --from=build /opt/scope-and-settle/app/JUDGING.md ./JUDGING.md
COPY fixtures/scope-judgment-cases.json ../fixtures/scope-judgment-cases.json
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/backend/server.js"]
