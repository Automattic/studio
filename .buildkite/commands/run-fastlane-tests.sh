#!/usr/bin/env bash

set -euo pipefail

if .buildkite/commands/should-skip-job.sh --job-type fastlane; then
  exit 0
fi

echo '--- :fastlane: Run fastlane Helper Tests'
for test_file in fastlane/test/*_test.rb; do
  ruby "$test_file"
done
