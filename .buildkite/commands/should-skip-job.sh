#!/usr/bin/env bash

set -eu

# Determines if a CI job should be skipped based on the files changed in the PR.
#
# Usage:
#   should-skip-job.sh --job-type <type>
#
# Job types:
#   - validation: Skip if changes are limited to documentation, config, localization, and non-code files.
#                 Used for lint, unit tests, and e2e tests.
#   - metrics: Same as validation, but also skips on test-only changes (apps/studio/e2e/**, *.test.ts).
#              Since metrics measure app performance, test file changes don't affect them.
#   - build: Skip if changes are limited to documentation and config files.
#            Does NOT skip on localization changes since builds should include translation updates.
#   - fastlane: Inverse of the others — only runs when fastlane/ or Ruby setup files change.
#               Used for the standalone tests in fastlane/test/. App-only PRs skip it.
#
# Exit codes:
#   0 - Job should be skipped
#   1 - Job should run

# Files that don't affect code quality, tests, or builds
# These are documentation, configuration, and metadata files
COMMON_NON_CODE_PATTERNS=(
  # Documentation
  "*.md"
  "*.txt"
  "docs/**"
  "CODE-OF-CONDUCT.md"
  "SECURITY.md"
  "LICENSE*"

  # Editor and IDE config
  ".editorconfig"
  ".vscode/**"

  # Git config
  ".gitignore"
  ".gitattributes"

  # GitHub-specific (workflows, templates, dependabot)
  ".github/**"

  # Ruby/Fastlane - only affects CI distribution, not app code
  "fastlane/**"
  "Gemfile"
  "Gemfile.lock"
  ".ruby-version"
  ".bundle/**"

  # CI configuration changes don't need app tests
  ".buildkite/**"

  # Installer assets and configuration
  "installers/**"
  "apps/studio/assets/appx/**"

  # Claude AI configuration
  ".claude/**"
  "CLAUDE.md"
)

# Localization files - changes here don't affect runtime behavior or performance
LOCALIZATION_PATTERNS=(
  "packages/common/translations/**"
)

# Test files - changes here don't affect app performance (for metrics)
TEST_PATTERNS=(
  "apps/studio/e2e/**"
  "apps/studio/src/tests/**"
  "apps/studio/src/**/*.test.ts"
  "apps/studio/src/**/*.test.tsx"
  "apps/cli/**/*.test.ts"
  "packages/common/**/*.test.ts"
  "metrics/**"
)

# Fastlane / Ruby setup files - changes here affect the standalone fastlane
# helper tests. Anything that the test runner reads (Fastfile, lib/, test/),
# that defines the Ruby environment, or that implements this CI job's runner /
# skip logic belongs here.
FASTLANE_PATTERNS=(
  "fastlane/**"
  "Gemfile"
  "Gemfile.lock"
  ".ruby-version"
  ".bundle/**"
  ".buildkite/commands/run-fastlane-tests.sh"
  ".buildkite/commands/should-skip-job.sh"
)

show_skip_message() {
  local job_type=$1
  local job_label="${BUILDKITE_LABEL:-$job_type}"
  local message="Skipping ${job_label} - no relevant files changed"
  local context="skip-$(echo "${job_label}" | sed -E -e 's/[^[:alnum:]]+/-/g' | tr '[:upper:]' '[:lower:]')"

  # Post annotation to Buildkite UI
  if command -v buildkite-agent &> /dev/null; then
    echo "$message" | buildkite-agent annotate --style "info" --context "$context"
  fi

  echo "~~~ :fast_forward: $message"
}

# Parse arguments
job_type=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --job-type)
      job_type="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

if [[ -z "$job_type" ]]; then
  echo "Error: --job-type is required"
  echo "Usage: should-skip-job.sh --job-type <validation|metrics|build|fastlane>"
  exit 1
fi

# Check if pr_changed_files command is available
if ! command -v pr_changed_files &> /dev/null; then
  echo "pr_changed_files command not found. Running job."
  exit 1
fi

case "$job_type" in
  "validation")
    # Skip validation jobs (lint, unit tests, e2e) if ALL changes are in
    # non-code files OR localization-only changes
    PATTERNS=("${COMMON_NON_CODE_PATTERNS[@]}" "${LOCALIZATION_PATTERNS[@]}")
    if pr_changed_files --all-match "${PATTERNS[@]}"; then
      show_skip_message "$job_type"
      exit 0
    fi
    ;;

  "metrics")
    # Skip metrics if ALL changes are in non-code files, localization, OR test files.
    # Test file changes don't affect app performance, so metrics don't need to run.
    PATTERNS=("${COMMON_NON_CODE_PATTERNS[@]}" "${LOCALIZATION_PATTERNS[@]}" "${TEST_PATTERNS[@]}")
    if pr_changed_files --all-match "${PATTERNS[@]}"; then
      show_skip_message "$job_type"
      exit 0
    fi
    ;;

  "build")
    # Skip build if ALL changes are in non-code files.
    # Note: Does NOT skip on localization changes - builds should include translation updates.
    if pr_changed_files --all-match "${COMMON_NON_CODE_PATTERNS[@]}"; then
      show_skip_message "$job_type"
      exit 0
    fi
    ;;

  "fastlane")
    # Run only if at least one changed file is fastlane/ or Ruby-setup-related.
    # Other job types treat fastlane changes as non-code; this one is the inverse.
    if ! pr_changed_files --any-match "${FASTLANE_PATTERNS[@]}"; then
      show_skip_message "$job_type"
      exit 0
    fi
    ;;

  *)
    echo "Unknown job type: $job_type"
    echo "Valid types: validation, metrics, build, fastlane"
    exit 1
    ;;
esac

# Job should run
exit 1
