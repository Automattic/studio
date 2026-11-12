#!/usr/bin/env bash

set -euo pipefail

echo '--- :aws: Install AWS CLI for the cache helpers'
apt-get -o Acquire::Retries=3 update
apt-get install -y --no-install-recommends awscli jq

echo '--- :package: Install deps'
bash .buildkite/commands/install-node-dependencies.sh | tee install.log

if [[ -n "${EXPECT_WARM_NPM_CACHE:-}" ]]; then
  if grep -q '^Restoring cache entry studio-npm-Linux-' install.log; then
    echo '✅ Warm npm cache restored from S3 inside the container'
    exit 0
  fi
  echo '⛔ Expected a warm npm cache restore, got a miss'
  exit 1
fi

echo '--- :eslint: Lint'
npm run lint

echo '--- :scissors: Unused code'
npm run knip

echo '--- :typescript: Typecheck'
npm run typecheck
