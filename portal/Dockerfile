# The portal image. Nothing environment-specific is baked in: every setting is read when
# the container starts (see .env.local.example and the Helm chart), so one image serves
# any cluster.
#
#   docker buildx build --platform linux/amd64 -t <registry>/headless-fleet-portal:0.1.0 --push .
#
# --platform matters on Apple silicon: without it the image is arm64 and fails on most
# cluster nodes with "exec format error".

ARG NODE_IMAGE=node:24.22.0-alpine3.24

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM ${NODE_IMAGE} AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# App files stay owned by root (read-only to the app). Only Next's cache is writable;
# the chart mounts an emptyDir there when the root filesystem is read-only.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/scripts/preflight.mjs ./preflight.mjs
RUN mkdir -p .next/cache && chown node:node .next/cache
USER node
EXPOSE 3000
CMD ["node", "server.js"]
