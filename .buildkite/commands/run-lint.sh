#!/usr/bin/env bash

set -euo pipefail

echo '--- :package: Install deps'
bash .buildkite/commands/install-node-dependencies.sh

echo '--- :eslint: Lint'
npm run lint

echo '--- :scissors: Unused code'
npm run knip

echo '--- :typescript: Typecheck'
npm run typecheck
