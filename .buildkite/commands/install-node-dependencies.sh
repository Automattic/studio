#!/bin/bash

set -eu

PLATFORM=$(uname -s)
ARCHITECTURE=$(uname -m)
NODE_VERSION=$(node --version)
PACKAGE_HASH=$(hash_file pnpm-lock.yaml)

if [ -d patches ]; then
  PATCHES_HASH=$(hash_directory patches/)
else
  PATCHES_HASH=nopatch
fi

CACHEKEY="$BUILDKITE_PIPELINE_SLUG-pnpm-$PLATFORM-$ARCHITECTURE-node-$NODE_VERSION-$PACKAGE_HASH-$PATCHES_HASH"

# Set up pnpm store location for caching
LOCAL_PNPM_STORE=./vendor/pnpm-store
mkdir -p $LOCAL_PNPM_STORE

echo "--- :package: Install pnpm via corepack"
corepack enable
corepack prepare pnpm@latest --activate

echo "--- :package: Set pnpm store to $LOCAL_PNPM_STORE"
pnpm config set store-dir $LOCAL_PNPM_STORE
echo "pnpm store set to $(pnpm config get store-dir)"

echo "--- :package: Restore pnpm cache if present"
restore_cache "$CACHEKEY"

echo "--- :package: Install Node dependencies with pnpm"

# pnpm is generally more reliable with concurrent connections than npm
# but we can still limit if needed
NETWORK_CONCURRENCY=16

if [ "$PLATFORM" = "Linux" ]; then
  NETWORK_CONCURRENCY=4
fi

pnpm install \
  --frozen-lockfile \
  --prefer-offline \
  --network-concurrency "$NETWORK_CONCURRENCY" \
  "$@"

cd cli
pnpm install \
  --frozen-lockfile \
  --prefer-offline \
  --network-concurrency "$NETWORK_CONCURRENCY"
cd -

echo "--- :package: Save cache if necessary"
# Cache the pnpm store which contains all downloaded packages.
# pnpm's content-addressable store is very efficient for caching.
save_cache "$LOCAL_PNPM_STORE" "$CACHEKEY"
