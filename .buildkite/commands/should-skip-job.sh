#!/usr/bin/env bash

set -eu

# Determines if a CI job should be skipped based on the files changed in the PR.
# `shared-pipeline-vars` runs it on the upload agent for each job type and exports the result as SKIP_<JOB TYPE>,
# which `pipeline.yml` uses as the `skip:` of matching steps, so skipped jobs never start.
#
# Usage:
#   should-skip-job.sh <job-type>
#
# Prints the reason to skip the job, or `false` to run it. Exits 0 either way, and 15 for invalid arguments.
# Non-PR builds, and any error while getting the changed files, run the job.
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

  # Release pipelines don't run the test jobs. The PR pipeline, its shared
  # variables and the scripts in .buildkite/commands do, so changes to them
  # run every check.
  ".buildkite/release-pipelines/**"
  ".buildkite/release-build-and-distribute.yml"

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

# Studio Code agent files - the agent's runtime, tools, skills, and eval runner.
# Lint, unit tests and CLI E2E still run on these; the desktop E2E and metrics
# suites never start an agent turn.
AGENT_PATTERNS=(
  "apps/cli/ai/**"
  "packages/agent/node/runtime/**"
  "packages/agent/shared/**"
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

run_job() { echo false; exit 0; }
# Buildkite rejects the whole pipeline upload if a `skip:` reason is longer than 70 characters.
skip_job() { echo "${1:0:70}"; exit 0; }

if [[ $# -ne 1 || -z "${1:-}" ]]; then
  echo "Usage: should-skip-job.sh <validation|e2e|metrics|build|fastlane>" >&2
  exit 15
fi

# Outside a pull request, run the job without looking up changed files.
[[ "${BUILDKITE_PULL_REQUEST:-false}" =~ ^[0-9]+$ ]] || run_job

case "$1" in
  "validation")
    # Skip validation jobs (lint, unit tests, e2e) if ALL changes are in
    # non-code files OR localization-only changes
    PATTERNS=("${COMMON_NON_CODE_PATTERNS[@]}" "${LOCALIZATION_PATTERNS[@]}")
    if pr_changed_files --all-match "${PATTERNS[@]}"; then
      skip_job "Only docs, config or localization files changed"
    fi
    ;;

  "e2e")
    # Skip desktop e2e if ALL changes are in non-code files, localization, OR agent files.
    PATTERNS=("${COMMON_NON_CODE_PATTERNS[@]}" "${LOCALIZATION_PATTERNS[@]}" "${AGENT_PATTERNS[@]}")
    if pr_changed_files --all-match "${PATTERNS[@]}"; then
      skip_job "Only docs, config, localization or agent files changed"
    fi
    ;;

  "metrics")
    # Skip metrics if ALL changes are in non-code files, localization, test files, OR agent files.
    # Neither test nor agent file changes affect what the metrics suites measure.
    PATTERNS=("${COMMON_NON_CODE_PATTERNS[@]}" "${LOCALIZATION_PATTERNS[@]}" "${TEST_PATTERNS[@]}" "${AGENT_PATTERNS[@]}")
    if pr_changed_files --all-match "${PATTERNS[@]}"; then
      skip_job "Only docs, config, localization, test or agent files changed"
    fi
    ;;

  "build")
    # Skip build if ALL changes are in non-code files.
    # Note: Does NOT skip on localization changes - builds should include translation updates.
    if pr_changed_files --all-match "${COMMON_NON_CODE_PATTERNS[@]}"; then
      skip_job "Only docs or config files changed"
    fi
    ;;

  "fastlane")
    # Run only if at least one changed file is fastlane/ or Ruby-setup-related.
    # Other job types treat fastlane changes as non-code; this one is the inverse.
    # An empty or failed diff must run the tests too, not look like "no fastlane files changed".
    pr_changed_files || run_job
    relevant=$(pr_changed_files --stdout --any-match "${FASTLANE_PATTERNS[@]}") || run_job
    if [[ "$relevant" == false ]]; then
      skip_job "No fastlane or Ruby setup files changed"
    fi
    ;;

  *)
    echo "Unknown job type: $1" >&2
    echo "Valid types: validation, e2e, metrics, build, fastlane" >&2
    exit 15
    ;;
esac

run_job
