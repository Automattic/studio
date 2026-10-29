#!/usr/bin/env bash

set -euo pipefail


echo '--- :aws: Install AWS CLI for the cache helpers'
apt-get -o Acquire::Retries=3 update
apt-get install -y --no-install-recommends awscli jq

echo '--- :package: Install deps'
bash .buildkite/commands/install-node-dependencies.sh

echo '--- :eslint: Lint'
npm run lint

echo '--- :scissors: Unused code'
npm run knip

echo '--- :typescript: Typecheck'
npm run typecheck
