#!/usr/bin/env bash
set -euo pipefail

PLATFORM=${1:-mac}

if .buildkite/commands/should-skip-job.sh --job-type validation; then
  exit 0
fi

echo '--- :package: Install deps'
if [ "$PLATFORM" = "linux" ]; then
  # Linux runs inside a Debian Node container on the shared `default` queue.
  # The a8c-ci-toolkit cache helpers (hash_file, restore_cache) only exist on
  # the host, so install-node-dependencies.sh can't run here. Unlike the UI e2e
  # suite, no Electron/Playwright runtime libs are needed: these tests drive the
  # CLI over Node and PHP-WASM, with no browser and no display server.
  npm ci --unsafe-perm --no-audit --no-progress --maxsockets 1
else
  bash .buildkite/commands/install-node-dependencies.sh
fi

echo '--- :node: Build CLI'
npm run cli:build

echo '--- :wordpress: Seed server files'
# Any CLI invocation copies the bundled WordPress into
# ~/.studio/server-files/wordpress-versions/latest, which the e2e harness requires.
node apps/cli/dist/cli/main.mjs site list

echo '--- :vitest: Run CLI E2E Tests'
# Serialize the files: each spins up its own sandbox WordPress + daemon, and
# booting several at once starves the CI host, flaking `site start`.
npm test -- --tagsFilter='e2e' --no-file-parallelism
