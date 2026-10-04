# syntax=docker/dockerfile:1
# Growize console for Zoho Catalyst AppSail (custom runtime, OCI image, linux/amd64 only).
# Build from the REPO ROOT:
#   docker build --platform linux/amd64 -f console/Dockerfile -t growize-console .
# Fixture/demo build (measurements, UI cases):  add  --build-arg GZ_LOCAL_BUILD=1
# No secrets here: every value arrives as an AppSail environment variable at run time.

FROM node:22-slim AS deps
WORKDIR /app/console
COPY console/package.json console/package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-slim AS build
ARG GZ_LOCAL_BUILD=0
ENV NEXT_TELEMETRY_DISABLED=1 GZ_LOCAL_BUILD=${GZ_LOCAL_BUILD}
WORKDIR /app/console
COPY --from=deps /app/console/node_modules ./node_modules
COPY console/ ./
# FIXTURE_MODE only matters at run time; the build needs just GZ_LOCAL_BUILD (it picks the dist dir).
RUN if [ "$GZ_LOCAL_BUILD" = "1" ]; then D=.next-local; else D=.next; fi \
 && FIXTURE_MODE=$([ "$GZ_LOCAL_BUILD" = "1" ] && echo local || echo "") npx next build \
 && mkdir -p public /out && cp -r "$D/standalone/." /out/ && cp -r "$D/static" /out/static-assets \
 && echo "$D" > /out/.distdir

FROM node:22-slim AS run
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app/console
# The app reads ../contracts and ../pm/merge-audit/ui-sahil (fixture catalogue) relative to its cwd.
COPY contracts/ /app/contracts/
COPY pm/merge-audit/ui-sahil/fixtures-merged.json /app/pm/merge-audit/ui-sahil/fixtures-merged.json
COPY --from=build /out/ ./
COPY --from=build /app/console/public ./public
# static assets belong under <distDir>/static
RUN D=$(cat .distdir) && mkdir -p "$D" && mv static-assets "$D/static" && rm .distdir \
 && mkdir -p /app/data /tmp/gz && chown -R node:node /app/data /tmp/gz /app/console
USER node
EXPOSE 9000
# Catalyst gives the port in X_ZOHO_CATALYST_LISTEN_PORT (default 9000); it must be listening within 10 s.
CMD ["sh", "-c", "PORT=${X_ZOHO_CATALYST_LISTEN_PORT:-9000} HOSTNAME=0.0.0.0 exec node server.js"]
