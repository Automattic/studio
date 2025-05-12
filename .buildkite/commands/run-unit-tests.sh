#!/bin/bash -eu

echo "--- :npm: Run Unit Tests"

# Get changed files for PR
if [ "$BUILDKITE_PULL_REQUEST" != "false" ]; then
  echo "--- :git: Getting changed files"
  CHANGED_FILES=$(git diff --name-only origin/$BUILDKITE_PULL_REQUEST_BASE_BRANCH...HEAD | grep -E '\.(ts|tsx)$' | grep -v 'node_modules' || true)
  echo "Changed files:"
  echo "$CHANGED_FILES"
fi

# Run tests with coverage
npm test -- --coverage

# Generate coverage report for PRs
if [ "$BUILDKITE_PULL_REQUEST" != "false" ] && [ -n "$CHANGED_FILES" ]; then
  echo "--- :memo: Generating coverage report"

  # Create coverage report
  cat << EOF > coverage-report.md
## Code Coverage Report
Files changed in this PR:
<pre>
$CHANGED_FILES
</pre>

Coverage Summary:
<pre>
$(cat coverage/coverage-summary.json | jq -r '.total')
</pre>
EOF

  # Comment on PR
  echo "--- :github: Commenting on PR"
  buildkite-agent annotate --style info --context coverage-report < coverage-report.md
fi
