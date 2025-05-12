#!/bin/bash -eu

# Runs unit tests and generates a coverage report that's displayed in the buildkite UI

if [ "$BUILDKITE_PULL_REQUEST" != "false" ]; then
  echo "--- :git: Getting changed files"
  CHANGED_FILES=$(git diff --name-only origin/$BUILDKITE_PULL_REQUEST_BASE_BRANCH...HEAD | grep -E '\.(ts|tsx)$' | grep -v 'node_modules' || true)
  echo "Changed files:"
  echo "$CHANGED_FILES"

  if [ -n "$CHANGED_FILES" ]; then
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

    echo "--- :git: Getting base branch coverage"
    git checkout origin/$BUILDKITE_PULL_REQUEST_BASE_BRANCH
    npm test -- --coverage --coverageReporters="json-summary"
    cp coverage/coverage-summary.json base-coverage-summary.json

    git checkout $CURRENT_BRANCH
  fi
fi

echo "--- :npm: Run Unit Tests"
npm test -- --coverage --coverageReporters="json-summary"

if [ "$BUILDKITE_PULL_REQUEST" != "false" ] && [ -n "$CHANGED_FILES" ]; then
  echo "--- :memo: Generating coverage report"

  echo "### Coverage for Changed Files" > coverage-report.md
  echo "" >> coverage-report.md
  echo "| File | Current | Previous | Change |" >> coverage-report.md
  echo "|------|---------|----------|--------|" >> coverage-report.md

  for FILE in $CHANGED_FILES; do
    # Skip files that don't have coverage data
    if ! jq -e ".[\"$PWD/$FILE\"]" coverage/coverage-summary.json > /dev/null 2>&1; then
      echo "| \`$FILE\` | No data | - | - |" >> coverage-report.md
      continue
    fi

    # Get current file coverage
    CURRENT_FILE_COVERAGE=$(jq -r ".[\"$PWD/$FILE\"].statements.pct" coverage/coverage-summary.json)

    # Check if we have base coverage for comparison
    if [ -f "base-coverage-summary.json" ] && jq -e ".[\"$PWD/$FILE\"]" base-coverage-summary.json > /dev/null 2>&1; then
      # Get base coverage for the file
      BASE_FILE_COVERAGE=$(jq -r ".[\"$PWD/$FILE\"].statements.pct" base-coverage-summary.json)

      # Compare coverage values (using simple integer comparison)
      if [ "$CURRENT_FILE_COVERAGE" -gt "$BASE_FILE_COVERAGE" ]; then
        CHANGE="⬆️ (improved)"
      elif [ "$CURRENT_FILE_COVERAGE" -lt "$BASE_FILE_COVERAGE" ]; then
        CHANGE="⬇️ (decreased)"
      else
        CHANGE="No change"
      fi

      echo "| \`$FILE\` | $CURRENT_FILE_COVERAGE% | $BASE_FILE_COVERAGE% | $CHANGE |" >> coverage-report.md
    else
      # No previous coverage data
      echo "| \`$FILE\` | $CURRENT_FILE_COVERAGE% | No data | New file |" >> coverage-report.md
    fi
  done

  echo "--- :github: Commenting on PR"
  buildkite-agent annotate --style info --context coverage-report < coverage-report.md
fi
