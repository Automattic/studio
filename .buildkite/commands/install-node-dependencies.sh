#!/bin/bash

set -eu

PLATFORM=$(uname -s)
ARCHITECTURE=${FILE_ARCHITECTURE:-$(uname -m)}
NODE_VERSION=$(node --version)
NPM_VERSION=$(npm --version)
PACKAGE_HASH=$(hash_file package-lock.json)
IMAGE_KEY=${IMAGE_ID:-noimage}
CACHE_FORMAT_VERSION=v2

PATCHES_HASH=nopatch
if [ -d apps/cli/patches ] || [ -d apps/studio/patches ]; then
  CLI_PATCHES_HASH=$( [ -d apps/cli/patches ] && hash_directory apps/cli/patches || echo none )
  STUDIO_PATCHES_HASH=$( [ -d apps/studio/patches ] && hash_directory apps/studio/patches || echo none )
  PATCHES_HASH=$(echo "${CLI_PATCHES_HASH}-${STUDIO_PATCHES_HASH}" | shasum -a 256 | awk '{print $1}')
fi

BASE_CACHE_KEY="$BUILDKITE_PIPELINE_SLUG-$CACHE_FORMAT_VERSION-$PLATFORM-$ARCHITECTURE-image-$IMAGE_KEY-node-$NODE_VERSION-npm-$NPM_VERSION-$PACKAGE_HASH-$PATCHES_HASH"
NPM_CACHE_KEY="$BASE_CACHE_KEY-npm-cache"
NODE_MODULES_CACHE_KEY="$BASE_CACHE_KEY-node-modules"

LOCAL_NPM_CACHE=./vendor/npm
mkdir -p $LOCAL_NPM_CACHE
echo "--- :npm: Set npm to use $LOCAL_NPM_CACHE for cache"
npm set cache $LOCAL_NPM_CACHE
echo "npm cache set to $(npm get cache)"

echo "--- :npm: Restore npm cache if present"
restore_cache "$NPM_CACHE_KEY"

echo "--- :npm: Restore node_modules cache if present"
NODE_MODULES_CACHE_HIT=false
if restore_cache "$NODE_MODULES_CACHE_KEY" && [ -d node_modules ]; then
  NODE_MODULES_CACHE_HIT=true
fi

if [ "$NODE_MODULES_CACHE_HIT" = true ]; then
  echo "--- :npm: Reusing cached node_modules"
else
  echo "--- :npm: Install Node dependencies"

  MAX_SOCKETS=15 # Default value from npm

  # To avoid constant ECONNRESET errors a limit is set for Linux,
  # as this is not happening with the Mac jobs.
  # This issue is being tracked here:
  # https://github.com/npm/cli/issues/4652
  if [ "$PLATFORM" = "Linux" ]; then
    MAX_SOCKETS=1
  fi

  npm ci \
    --include=dev \
    --prefer-offline \
    --no-audit \
    --no-progress \
    --maxsockets "$MAX_SOCKETS" \
    "$@"
fi

echo "--- :npm: Save cache if necessary"
# We cache both npm's download cache and root node_modules with a strict
# environment+lockfile key. node_modules is saved only after npm ci runs.
#
# npm stores temporary files in ~/.npm that we don't want to extract because they might run into naming conflicts.
# So, before archiving it, we remove those tmp files.
#
# Example: https://buildkite.com/automattic/gutenberg-mobile/builds/8857#018e37eb-7afc-4280-b736-cba76f02f1a3/524
rm -rf "$LOCAL_NPM_CACHE/_cacache/tmp"
save_cache "$LOCAL_NPM_CACHE" "$NPM_CACHE_KEY"

if [ "$NODE_MODULES_CACHE_HIT" = false ]; then
  save_cache node_modules "$NODE_MODULES_CACHE_KEY"
fi
