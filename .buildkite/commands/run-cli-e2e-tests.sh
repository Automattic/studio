#!/usr/bin/env bash
set -euo pipefail

PLATFORM=${1:-mac}

if .buildkite/commands/should-skip-job.sh --job-type validation; then
  exit 0
fi

echo '--- :package: Install deps'
if [ "$PLATFORM" = "linux" ]; then
  # The a8c-ci-toolkit cache helpers only exist on the host, so
  # install-node-dependencies.sh cannot run inside the Linux container.
  npm ci --unsafe-perm --no-audit --no-progress --maxsockets 1
else
  bash .buildkite/commands/install-node-dependencies.sh
fi

echo '--- :wordpress: Download language packs'
# Shipped builds bundle these (see forge.config.ts). Without them, creating a non-English site
# downloads its translations from wordpress.org mid-test, which is where the localization e2e
# test flaked. `cli:build` copies wp-files into dist, so this has to run first.
STUDIO_LANGUAGE_PACK_LOCALES=ja npm run download-language-packs

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
