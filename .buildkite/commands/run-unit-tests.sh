#!/bin/bash -eu

# Runs unit tests and generates a coverage report that's displayed in the buildkite UI

if [ "$BUILDKITE_PULL_REQUEST" != "false" ]; then
  echo "--- :git: Getting changed files"
  CHANGED_FILES=$(git diff --name-only origin/$BUILDKITE_PULL_REQUEST_BASE_BRANCH...HEAD | grep -E '\.(ts|tsx)$' | grep -v 'node_modules' || true)
  echo "Changed files:"
  echo "$CHANGED_FILES"
fi

echo "--- :npm: Run Unit Tests"
npm test -- --coverage

if [ "$BUILDKITE_PULL_REQUEST" != "false" ] && [ -n "$CHANGED_FILES" ]; then
  echo "--- :memo: Generating coverage report"

  echo "### Code Coverage Report" > coverage-report.md

  echo "" >> coverage-report.md

  echo "| File | Coverage |" >> coverage-report.md
  echo "|------|----------|" >> coverage-report.md

  for FILE in $CHANGED_FILES; do
    echo "| \`$FILE\` | " > coverage-report.md

    if ! jq -e ".[\"$PWD/$FILE\"]" coverage/coverage-summary.json > /dev/null 2>&1; then
      echo -n " – " >> coverage-report.md
    else
      jq -r ".[\"$PWD/$FILE\"] | \"\" + (.statements.pct | tostring) + \"%\"" coverage/coverage-summary.json | tr -d '\n' >> coverage-report.md
    fi

    echo " |" >> coverage-report.md
  done

  echo "--- :github: Commenting on PR"
  buildkite-agent annotate --style info --context coverage-report < coverage-report.md
fi
