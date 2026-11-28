#!/usr/bin/env bash

# Sourced by the docs refresh, in CI and from scripts/docs-refresh/run-local.sh: installs and
# builds what the capture harness needs in the container, and bakes the docs' scene.

HARNESS=(node --experimental-strip-types tools/capture-harness/cli.ts)
SCENE=moire

echo "--- :npm: Install Node dependencies"
# The a8c-ci-toolkit cache helpers install-node-dependencies.sh needs don't exist in the container.
npm ci --unsafe-perm --no-audit --no-progress --maxsockets 1

echo "--- :hammer: Set up the capture harness"
# --rebuild: a checkout kept between local runs has the last run's build.
# Both drivers: the browser app for the docs images, Studio Desktop for the few shots only it has.
"${HARNESS[@]}" setup --rebuild
"${HARNESS[@]}" bake --scene "$SCENE"
