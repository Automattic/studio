#!/usr/bin/env bash
set -euo pipefail

PLATFORM=${1:-mac}

# Skipped here rather than with an `if:` guard on the group, which would stop
# the required check reporting — see the CLI E2E group in .buildkite/pipeline.yml.
if [[ "${BUILDKITE_PULL_REQUEST_DRAFT:-false}" == "true" ]]; then
  message="Skipping CLI E2E - draft PR. They run in full once it is marked ready for review."
  if command -v buildkite-agent &> /dev/null; then
    echo "$message" | buildkite-agent annotate --style "info" --context "skip-cli-e2e-draft" || true
  fi
  echo "~~~ :fast_forward: $message"
  exit 0
fi

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
