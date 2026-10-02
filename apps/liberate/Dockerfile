# liberate.sh production image. Build it from the repository root:
#   docker build -f apps/liberate/Dockerfile -t liberate .

FROM node:24-bookworm-slim AS base
ENV NODE_ENV=production \
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

FROM base AS build
COPY --from=manifests /app ./
RUN npm ci --include=dev --workspace @studio/liberate --ignore-scripts
# The app's tsconfig extends it, and Vite reads it while transforming.
COPY tsconfig.base.json ./
COPY apps/liberate apps/liberate
RUN npm run build --workspace @studio/liberate

FROM base
RUN apt-get update \
	&& apt-get install -y --no-install-recommends tini \
	&& rm -rf /var/lib/apt/lists/*

COPY --from=manifests /app ./
RUN npm ci --omit=dev --workspace @studio/liberate --ignore-scripts \
	&& npm cache clean --force
COPY --from=build /app/apps/liberate/dist apps/liberate/dist
COPY apps/liberate/src apps/liberate/src

ENV PORT=8080
EXPOSE 8080
ENTRYPOINT [ "tini", "--" ]
CMD [ "node", "apps/liberate/src/server/index.ts" ]
