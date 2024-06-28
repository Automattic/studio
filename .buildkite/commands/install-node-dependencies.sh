#!/bin/bash -eu

PLATFORM=$(uname -s)
ARCHITECTURE=$(uname -m)
NODE_VERSION=$(node --version)
PACKAGE_HASH=$(hash_file package-lock.json)

if [ -d patches ]; then
  PATCHES_HASH=$(hash_directory patches/)
else
  PATCHES_HASH=nopatch
fi

CACHEKEY="$BUILDKITE_PIPELINE_SLUG-npm-$PLATFORM-$ARCHITECTURE-node-$NODE_VERSION-$PACKAGE_HASH-$PATCHES_HASH"

LOCAL_NPM_CACHE=./vendor/npm
mkdir -p $LOCAL_NPM_CACHE
echo "--- :npm: Set npm to use $LOCAL_NPM_CACHE for cache"
npm set cache $LOCAL_NPM_CACHE
echo "npm cache set to $(npm get cache)"

echo "--- :npm: Restore npm cache if present"
restore_cache "$CACHEKEY"

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
  --unsafe-perm \
  --prefer-offline \
  --no-audit \
  --no-progress \
  --maxsockets "$MAX_SOCKETS" \
  "$@"

echo "--- :npm: Save cache if necessary"
# Notice that we don't cache the local node_modules.
# Those get regenerated by npm ci as per Node reccomendations.
# What we are caching is the root npm folder, which stores pacakge downloads so they are available if the package.json resolution demands them.
#
# npm stores temporary files in ~/.npm that we don't want to extract because they might run into naming conflicts.
# So, before archiving it, we remove those tmp files.
#
# Example: https://buildkite.com/automattic/gutenberg-mobile/builds/8857#018e37eb-7afc-4280-b736-cba76f02f1a3/524
rm -rf "$LOCAL_NPM_CACHE/_cacache/tmp"
save_cache "$LOCAL_NPM_CACHE" "$CACHEKEY"
