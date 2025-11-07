#!/usr/bin/env bash
set -euo pipefail

MATRIX=${1:-}

echo '--- :package: Install deps'
bash .buildkite/commands/install-node-dependencies.sh

echo '--- :npm: Run Unit Tests'
npm run test

