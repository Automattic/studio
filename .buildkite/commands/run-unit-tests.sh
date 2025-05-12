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
  echo "## Code Coverage Report" > coverage-report.md
  echo "Files changed in this PR:" >> coverage-report.md
  echo "<pre>" >> coverage-report.md
  echo "$CHANGED_FILES" >> coverage-report.md
  echo "</pre>" >> coverage-report.md

  echo "" >> coverage-report.md
  echo "Coverage Summary per File:" >> coverage-report.md
  echo "<pre>" >> coverage-report.md

  # Process each changed file to extract coverage data
  for FILE in $CHANGED_FILES; do
    # Skip files that don't have coverage data
    if ! jq -e ".[\"$PWD/$FILE\"]" coverage/coverage-summary.json > /dev/null 2>&1; then
      echo "No coverage data for: $FILE" >> coverage-report.md
      continue
    fi

    # Extract and format coverage data for the file
    echo "File: $FILE" >> coverage-report.md
    jq -r ".[\"$PWD/$FILE\"] | \"Coverage: \" + (.statements.pct | tostring) + \"%\"" coverage/coverage-summary.json >> coverage-report.md
    echo "" >> coverage-report.md
  done

  echo "</pre>" >> coverage-report.md

  # Comment on PR
  echo "--- :github: Commenting on PR"
  buildkite-agent annotate --style info --context coverage-report < coverage-report.md
fi
