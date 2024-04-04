#!/bin/bash -eu

# Prepares an existing binary for distribution and generates its corresponding manifest.

echo "--- 📃 Notarizing Binary"
bundle exec fastlane notarize_binary

echo "--- :node: Generate Releases Manifest"
node ./scripts/generate-releases-manifest.mjs
