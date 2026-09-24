# liberate.sh production image. Build it from the repository root:
#   docker build -f apps/liberate/Dockerfile -t liberate .

FROM node:24-bookworm-slim AS base
ENV NODE_ENV=production \
	PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
	NPM_CONFIG_UPDATE_NOTIFIER=false \
	NPM_CONFIG_FUND=false \
	NPM_CONFIG_AUDIT=false
WORKDIR /app

# Every workspace manifest plus the lockfile: `npm ci` needs all of them, and
# copying only these keeps the dependency layers cached until they change.
FROM base AS manifests
COPY . /src
RUN cd /src \
	&& find . -name package.json -not -path '*/node_modules/*' -exec cp --parents {} /app \; \
	&& cp package-lock.json /app/

# The Studio CLI is built from this repository rather than installed from npm, so the
# service always runs the same code as the branch it was deployed from.
FROM base AS build
COPY --from=manifests /app ./
RUN npm ci --include=dev --include-workspace-root \
	--workspace wp-studio --workspace @studio/liberate --ignore-scripts
COPY tsconfig.base.json ./
COPY scripts scripts
# Checked in, unlike the rest of `wp-files`, and the native PHP runtime runs Blueprints with it.
COPY wp-files/blueprints/blueprints.phar wp-files/blueprints/
COPY packages packages
COPY apps/local apps/local
COPY apps/cli apps/cli
# WordPress, WP-CLI and the SQLite integration ship inside the CLI bundle.
RUN node --experimental-strip-types scripts/download-wp-server-files.ts
RUN npm run build --workspace wp-studio
# The PHP binary the sites run on, bundled so the first job doesn't wait for a download. The
# script only warns when the download fails, and an image without PHP cannot run a site.
RUN STUDIO_PHP_BINARY_DOWNLOAD_REQUIRED=1 node --experimental-strip-types \
	scripts/download-php-binary.ts --install-root apps/cli/dist/php-bin
COPY apps/liberate apps/liberate
RUN npm run build --workspace @studio/liberate

FROM base
RUN apt-get update \
	&& apt-get install -y --no-install-recommends tini \
	&& rm -rf /var/lib/apt/lists/*

COPY --from=manifests /app ./
RUN npm ci --omit=dev --workspace wp-studio --workspace @studio/liberate --ignore-scripts \
	&& npm cache clean --force
# Headless Chromium and its system libraries, for the Data Liberation crawler.
RUN npx playwright install --with-deps --only-shell chromium

COPY --from=build /app/apps/cli/dist apps/cli/dist
COPY --from=build /app/apps/liberate/dist apps/liberate/dist
COPY apps/liberate/src apps/liberate/src

ENV STUDIO_CLI=/app/apps/cli/dist/cli/main.mjs \
	PORT=8080
EXPOSE 8080
ENTRYPOINT [ "tini", "--" ]
CMD [ "node", "apps/liberate/src/server/index.ts" ]
