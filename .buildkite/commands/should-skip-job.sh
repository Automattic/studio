#!/usr/bin/env bash

set -eu

# Determines if a CI job should be skipped based on the changed files.
# Webhook PR and trunk builds can skip; STUDIO_CI_FULL_BUILD=1 forces a full run.
# trunk compares HEAD to its first parent; CI_CHANGED_FILES_BASE supplies a wider range.
#
# Usage:
#   should-skip-job.sh --job-type <type>
#
# Job types:
#   - validation: Skip if changes are limited to documentation, config, localization, and non-code files.
#                 Used for lint, unit tests, and CLI e2e tests.
#   - e2e: Same as validation, but also skips on Studio Code agent-only changes.
#          The desktop E2E suite runs with AI features off, so it never runs agent code.
#   - metrics: Same as validation, but also skips on test-only and agent-only changes.
#              Since metrics measure app performance, test file changes don't affect them,
#              and the metrics suites never run agent code.
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
  "LICENSE*"

  # Editor and IDE config
  ".editorconfig"
  ".vscode/**"

  # Git config
  ".gitignore"
  ".gitattributes"

  # Preserve the existing GitHub and CI tooling exclusions for app checks.
  ".github/**"
  ".buildkite/**"

  # Ruby/Fastlane - only affects CI distribution, not app code
  "fastlane/**"
  "Gemfile"
  "Gemfile.lock"
  ".ruby-version"
  ".bundle/**"

  # Installer assets and configuration
  "installers/**"
  "apps/studio/assets/appx/**"

  # Claude AI configuration
  ".claude/**"
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

# Studio Code agent files - the agent's runtime, tools, skills, and eval runner.
# Lint, unit tests and CLI E2E still run on these; the desktop E2E and metrics
# suites never start an agent turn.
AGENT_PATTERNS=(
  "apps/cli/ai/**"
  "packages/agent/node/runtime/**"
  "packages/agent/node/tools/**"
  "packages/agent/node/skills/**"
  "apps/cli/commands/ai/**"
  "scripts/eval/**"
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
  ".buildkite/pipeline.yml"
  ".buildkite/shared-pipeline-vars"
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
    echo "$message" | buildkite-agent annotate --style "info" --context "$context" \
      || echo "Could not annotate the skipped job" >&2
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
  echo "Usage: should-skip-job.sh --job-type <validation|e2e|metrics|build|fastlane>"
  exit 1
fi

if [[ "${STUDIO_CI_FULL_BUILD:-}" == 1 || "${BUILDKITE_SOURCE:-}" != webhook ||
      -n "${BUILDKITE_TAG:-}" ]]; then
  exit 1
fi

if [[ "${BUILDKITE_PULL_REQUEST-false}" =~ ^[0-9]+$ ]]; then
  changed_files=(pr_changed_files)
elif [[ "${BUILDKITE_PULL_REQUEST-false}" == false && "${BUILDKITE_BRANCH:-}" == trunk ]]; then
  changed_files=(commit_changed_files)
  if [[ -n "${CI_CHANGED_FILES_BASE:-}" ]]; then
    changed_files+=(--base "$CI_CHANGED_FILES_BASE")
  fi
else
  exit 1
fi

# Docker jobs mount the toolkit; use anonymous HTTPS for this public repo there.
if [[ -d /a8c-ci-toolkit/bin ]]; then
  export PATH="$PATH:/a8c-ci-toolkit/bin"
  config_index=${GIT_CONFIG_COUNT:-0}
  export GIT_CONFIG_COUNT=$((config_index + 1))
  export "GIT_CONFIG_KEY_${config_index}=url.https://github.com/.insteadOf" "GIT_CONFIG_VALUE_${config_index}=git@github.com:"
fi

case "$job_type" in
  "validation")
    # Skip validation jobs (lint, unit tests, e2e) if ALL changes are in
    # non-code files OR localization-only changes
    PATTERNS=("${COMMON_NON_CODE_PATTERNS[@]}" "${LOCALIZATION_PATTERNS[@]}")
    if "${changed_files[@]}" --all-match "${PATTERNS[@]}"; then
      show_skip_message "$job_type"
      exit 0
    fi
    ;;

  "e2e")
    # Skip desktop e2e if ALL changes are in non-code files, localization, OR agent files.
    PATTERNS=("${COMMON_NON_CODE_PATTERNS[@]}" "${LOCALIZATION_PATTERNS[@]}" "${AGENT_PATTERNS[@]}")
    if "${changed_files[@]}" --all-match "${PATTERNS[@]}"; then
      show_skip_message "$job_type"
      exit 0
    fi
    ;;

  "metrics")
    # Skip metrics if ALL changes are in non-code files, localization, test files, OR agent files.
    # Neither test nor agent file changes affect what the metrics suites measure.
    PATTERNS=("${COMMON_NON_CODE_PATTERNS[@]}" "${LOCALIZATION_PATTERNS[@]}" "${TEST_PATTERNS[@]}" "${AGENT_PATTERNS[@]}")
    if "${changed_files[@]}" --all-match "${PATTERNS[@]}"; then
      show_skip_message "$job_type"
      exit 0
    fi
    ;;

  "build")
    # Skip build if ALL changes are in non-code files.
    # Note: Does NOT skip on localization changes - builds should include translation updates.
    if "${changed_files[@]}" --all-match "${COMMON_NON_CODE_PATTERNS[@]}"; then
      show_skip_message "$job_type"
      exit 0
    fi
    ;;

  "fastlane")
    # Run only if at least one changed file is fastlane/ or Ruby-setup-related.
    # Other job types treat fastlane changes as non-code; this one is the inverse.
    "${changed_files[@]}" || exit 1
    relevant=$("${changed_files[@]}" --stdout --any-match "${FASTLANE_PATTERNS[@]}") || exit 1
    if [[ "$relevant" == false ]]; then
      show_skip_message "$job_type"
      exit 0
    fi
    ;;

  *)
    echo "Unknown job type: $job_type"
    echo "Valid types: validation, e2e, metrics, build, fastlane"
    exit 1
    ;;
esac

# Job should run
exit 1
