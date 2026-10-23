FROM node:24.15.0-bookworm-slim AS build
WORKDIR /opt/scope-and-settle/app
RUN npm install --global pnpm@10.34.5
COPY app/package.json app/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY app/ ./
COPY JUDGING.md ../JUDGING.md
COPY deploy/gcp/webhook-lookup.mjs ../deploy/gcp/webhook-lookup.mjs
ARG PUBLIC_BASE_URL=https://scope-and-settle.hperkins.com
ARG SOURCE_COMMIT
ENV PUBLIC_BASE_URL=$PUBLIC_BASE_URL SOURCE_COMMIT=$SOURCE_COMMIT
RUN pnpm test
RUN pnpm package:plugin

FROM node:24.15.0-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 SCOPE_SETTLE_DATA_DIR=/var/data
WORKDIR /opt/scope-and-settle/app
RUN mkdir -p /var/data && chown node:node /var/data
COPY --from=build /opt/scope-and-settle/app/dist ./dist
COPY --from=build /opt/scope-and-settle/app/web ./web
COPY --from=build /opt/scope-and-settle/app/scripts ./scripts
COPY --from=build /opt/scope-and-settle/app/package.json ./package.json
COPY --from=build /opt/scope-and-settle/app/downloads ./downloads
COPY --from=build /opt/scope-and-settle/app/JUDGING.md ./JUDGING.md
COPY fixtures/ ../fixtures/
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/backend/server.js"]
