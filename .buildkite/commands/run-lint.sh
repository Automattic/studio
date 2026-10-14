#!/usr/bin/env bash

set -euo pipefail

PLATFORM=${1:-}

if .buildkite/commands/should-skip-job.sh --job-type validation; then
  exit 0
fi

if [ "$PLATFORM" = "linux" ]; then
  # Keep skip detection above this so it uses the HTTPS Git fallback in Docker.
  export PATH="$PATH:/a8c-ci-toolkit/bin"

  echo '--- :package: Install cache helper dependencies'
  apt-get -o Acquire::Retries=3 update
  apt-get install -y --no-install-recommends awscli jq
fi

echo '--- :package: Install deps'
bash .buildkite/commands/install-node-dependencies.sh

echo '--- :eslint: Lint'
npm run lint

echo '--- :typescript: Typecheck'
npm run typecheck
