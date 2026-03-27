#!/bin/bash

# Publishes the wp-studio npm package from the current working tree.
#
# Expects:
#   - NPM_TOKEN: npm automation token for authentication (Buildkite secret)
#   - NPM_TAG (optional): npm dist-tag to publish under (e.g., "next" for prereleases)
#
# Before publishing, this script:
#   1. Installs Node dependencies (which triggers postinstall → download-wp-server-files)
#   2. Downloads language packs into the wp-files directory
#
# The actual build is handled by the prepublishOnly lifecycle script in apps/cli/package.json.

set -euo pipefail

echo "--- :npm: Install Node dependencies"
.buildkite/commands/install-node-dependencies.sh

echo "--- :globe_with_meridians: Download language packs"
npm run download-language-packs

echo "--- :npm: Configure npm authentication"
echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > .npmrc

echo "--- :npm: Publish wp-studio package"
PUBLISH_ARGS=(-w wp-studio)

if [ -n "${NPM_TAG:-}" ]; then
  PUBLISH_ARGS+=(--tag "${NPM_TAG}")
  echo "Publishing with dist-tag: ${NPM_TAG}"
else
  echo "Publishing as latest"
fi

npm publish "${PUBLISH_ARGS[@]}"

echo "--- :white_check_mark: npm package published successfully"
