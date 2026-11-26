# Studio Electron e2e runner: CI's Linux recipe (.buildkite/commands/run-e2e-tests.sh) baked into an image.
ARG NODE_VERSION=24.22.1
FROM node:${NODE_VERSION}-bookworm

# CI's apt list (xvfb + Electron/Chromium runtime libs), plus rsync for the worktree sync and
# procps for ps/free while debugging.
RUN apt-get -o Acquire::Retries=3 update \
	&& apt-get install -y --no-install-recommends \
		xvfb xauth libcap2-bin libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgtk-3-0 \
		libgbm1 libasound2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
		libpango-1.0-0 libcairo2 libxss1 \
		rsync procps \
	&& rm -rf /var/lib/apt/lists/*

# /work: per-worktree volume (source copy + node_modules + out/ + downloads).
# /cache: shared volume (npm, Electron zips, Playwright browsers).
# Created here and owned by `node` so fresh named volumes inherit that ownership.
RUN mkdir -p /work /cache /tmp/studio-e2e-previous-release \
	&& chown node:node /work /cache /tmp/studio-e2e-previous-release

ENV npm_config_cache=/cache/npm \
	electron_config_cache=/cache/electron \
	PLAYWRIGHT_BROWSERS_PATH=/cache/ms-playwright

COPY sync-filter entry.sh /opt/e2e/
USER node
WORKDIR /work
ENTRYPOINT ["/opt/e2e/entry.sh"]
