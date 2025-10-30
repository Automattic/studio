#!/usr/bin/env bash
set -euo pipefail

MATRIX=${1:-}

echo '--- :wrench: Matrix setup'
if [ "$MATRIX" = "windows" ]; then
  # prepare_windows_host_for_app_distribution.ps1 comes from CI Toolkit Plugin
  powershell -Command "& 'prepare_windows_host_for_app_distribution.ps1' -InstallPython $true -InstallNativeCompilationTools $true"
fi

echo '--- :package: Install deps'
bash .buildkite/commands/install-node-dependencies.sh

export IS_DEV_BUILD=true

echo '--- :package: Package app for testing'
npm run package

echo '--- :playwright: Run End To End Tests'
npm run e2e


