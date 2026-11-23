#!/usr/bin/env bash

set -euo pipefail

echo '--- :fastlane: Run fastlane Helper Tests'
for test_file in fastlane/test/*_test.rb; do
  ruby "$test_file"
done
