#!/usr/bin/env bash
set -euo pipefail

MATRIX=${1:-}

echo '--- :package: Install deps'
if [ "$MATRIX" = "linux" ]; then
  # Linux runs inside a Docker container with the a8c-ci-toolkit mounted; its
  # cache helpers need the AWS CLI, as in the Lint job.
  apt-get -o Acquire::Retries=3 update
  apt-get install -y --no-install-recommends awscli jq
fi
bash .buildkite/commands/install-node-dependencies.sh

echo '--- :npm: Run Unit Tests'
npm run test -- --tagsFilter='!e2e'
