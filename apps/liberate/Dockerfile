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

FROM base
RUN apt-get update \
	&& apt-get install -y --no-install-recommends tini \
	&& rm -rf /var/lib/apt/lists/*

# The Studio CLI runs each liberated site with WordPress Playground, then exports it.
ARG STUDIO_CLI_VERSION=1.21.0
RUN npm install --global wp-studio@${STUDIO_CLI_VERSION} && npm cache clean --force

COPY --from=manifests /app ./
RUN npm ci --workspace @studio/liberate --workspace data-liberation --include=dev --ignore-scripts \
	&& npm cache clean --force
# Headless Chromium and its system libraries, for data-liberation's crawler.
RUN npx playwright install --with-deps --only-shell chromium

COPY tsconfig.base.json ./
COPY packages/data-liberation-agent packages/data-liberation-agent
COPY apps/liberate apps/liberate
RUN npm run build --workspace @studio/liberate

ENV PORT=8080
EXPOSE 8080
ENTRYPOINT [ "tini", "--" ]
CMD [ "node", "apps/liberate/src/server/index.ts" ]
