#!/bin/bash -eu

# Get changed files for PR
if [ "$BUILDKITE_PULL_REQUEST" != "false" ]; then
  echo "--- :git: Getting changed files"
  CHANGED_FILES=$(git diff --name-only origin/$BUILDKITE_PULL_REQUEST_BASE_BRANCH...HEAD | grep -E '\.(ts|tsx)$' | grep -v 'node_modules' || true)
  echo "Changed files:"
  echo "$CHANGED_FILES"
fi

# Run tests with coverage
echo "--- :npm: Run Unit Tests"
npm test -- --coverage

# Generate coverage report for PRs
if [ "$BUILDKITE_PULL_REQUEST" != "false" ] && [ -n "$CHANGED_FILES" ]; then
  echo "--- :memo: Generating coverage report"

  # Create coverage report
  echo "### Code Coverage Report" > coverage-report.md

  echo "" >> coverage-report.md

  echo "| File | Coverage |\n" >> coverage-report.md
  echo "|------|----------|\n" >> coverage-report.md

  # Process each changed file to extract coverage data
  for FILE in $CHANGED_FILES; do
    echo "| `$FILE` | " >> coverage-report.md

    if ! jq -e ".[\"$PWD/$FILE\"]" coverage/coverage-summary.json > /dev/null 2>&1; then
      echo " – " >> coverage-report.md
    else
      jq -r ".[\"$PWD/$FILE\"] | \"\" + (.statements.pct | tostring) + \"%\"" coverage/coverage-summary.json >> coverage-report.md
    fi

    echo " |\n" >> coverage-report.md
  done

  # Comment on PR
  echo "--- :github: Commenting on PR"
  buildkite-agent annotate --style info --context coverage-report < coverage-report.md
fi
