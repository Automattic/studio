#!/usr/bin/env bash
set -euo pipefail

# Verification PR only. Uses real helpers against a tiny Git history, without building the app.
scenario=${1:?Pass docs or code}
repo=$PWD
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT
cp -R .buildkite "$fixture/.buildkite"
for file in .xcode-version .nvmrc .ruby-version ios/.xcode-version; do
  if git cat-file -e "HEAD:$file" 2>/dev/null; then
    mkdir -p "$fixture/$(dirname "$file")"
    git show "HEAD:$file" > "$fixture/$file"
  fi
done
cd "$fixture"
git init -q
git config commit.gpgsign false
git config core.hooksPath /dev/null
git config user.name 'CI skip verification'
git config user.email 'ci-probe@example.invalid'
echo base > fixture-base
git add fixture-base
git commit -qm 'Fixture base'
base=$(git rev-parse HEAD)
case "$scenario" in
  docs) path='README.md'; expected=(1 1 1 1) ;;
  code) path='apps/studio/src/ci-probe.ts'; expected=(0 0 0 1) ;;
  *) echo "Expected docs or code" >&2; exit 1 ;;
esac
mkdir -p "$(dirname "$path")"
echo changed > "$path"
git add "$path"
git commit -qm 'Fixture merge (#999999)'
export BUILDKITE_SOURCE=webhook BUILDKITE_GITHUB_EVENT=push BUILDKITE_PULL_REQUEST=false BUILDKITE_BRANCH=trunk
export PIPELINE=pipeline.yml
unset BUILDKITE_TAG CI_CHANGED_FILES_BASE STUDIO_CI_FULL_BUILD

# Only substitute the push that triggered this synthetic Git history. Forward normal agent operations.
PROBE_AGENT=$(command -v buildkite-agent)
export PROBE_AGENT PROBE_WEBHOOK_READS="$fixture/.git/webhook-reads"
mkdir "$fixture/.git/bin"
cat > "$fixture/.git/bin/buildkite-agent" <<'AGENT'
#!/bin/sh
if [ "$*" = 'meta-data get buildkite:webhook' ]; then
  echo read >> "$PROBE_WEBHOOK_READS"
  printf '%s\n' "$PROBE_WEBHOOK"
else
  exec "$PROBE_AGENT" "$@"
fi
AGENT
chmod +x "$fixture/.git/bin/buildkite-agent"
export PATH="$fixture/.git/bin:$PATH"
set_push() {
  PROBE_WEBHOOK=$(jq -nc --arg before "$1" --arg after "$(git rev-parse HEAD)" \
    '{ref: "refs/heads/trunk", before: $before, after: $after, forced: false}')
  export PROBE_WEBHOOK
  : > "$PROBE_WEBHOOK_READS"
}
set_push "$base"
variables=(SKIP_VALIDATION SKIP_E2E SKIP_METRICS SKIP_FASTLANE)
read_vars() {
  # Start with the central uploader's bash -e options and no previous decision.
  set +u +o pipefail
  unset "${variables[@]}"
  source .buildkite/shared-pipeline-vars
  set -u -o pipefail
}
check_values() {
  local i value actual
  for ((i=0; i<${#variables[@]}; i++)); do
    value=${!variables[i]}
    actual=0
    [[ -z "$value" || "$value" == false ]] || actual=1
    [[ "$actual" == "${expected[i]}" ]] || { echo "Unexpected ${variables[i]}=$value" >&2; exit 1; }
  done
}
check_context() (
  # shellcheck disable=SC2163 # Each argument is a KEY=value assignment for this check.
  export "$@"
  read_vars
  check_values
)
read_vars
check_values
[[ $(wc -l < "$PROBE_WEBHOOK_READS") -eq 1 ]]
selected_expected=("${expected[@]}")
export PROBE_SKIP=${!variables[0]} PROBE_SCENARIO=$scenario
export CI_CHANGED_FILES_BASE=$base
read_vars
check_values
unset CI_CHANGED_FILES_BASE

# Informational render for review; no app or release jobs are submitted.
buildkite-agent pipeline upload --dry-run --format json .buildkite/trunk-probe-production.yml > "$repo/trunk-probe-$scenario.json"
buildkite-agent artifact upload "$repo/trunk-probe-$scenario.json"

# Full builds, invalid ranges and empty diffs must all run.
expected=(0 0 0 0)
export STUDIO_CI_FULL_BUILD=1
read_vars
check_values
unset STUDIO_CI_FULL_BUILD
export CI_CHANGED_FILES_BASE=missing-ci-probe-base
read_vars
check_values
export CI_CHANGED_FILES_BASE=HEAD
read_vars
check_values
unset CI_CHANGED_FILES_BASE

# A direct push without a PR-merge subject runs fully unless an explicit base is supplied.
git commit --amend -qm 'Fixture direct push'
set_push "$base"
read_vars
check_values
export CI_CHANGED_FILES_BASE=$base
expected=("${selected_expected[@]}")
read_vars
check_values
unset CI_CHANGED_FILES_BASE

# The last commit changes only docs. An explicit base also includes the previous fixture change.
echo 'Follow-up' > probe-summary.md
git add probe-summary.md
git commit -qm 'Fixture docs follow-up (#1000000)'
set_push "$(git rev-parse HEAD^1)"
expected=(1 1 1 1)
read_vars
check_values

other_base=$(git commit-tree "${base}^{tree}" -m 'Unrelated root')
set_push "$base"
expected=("${selected_expected[@]}")
read_vars
check_values
[[ $(wc -l < "$PROBE_WEBHOOK_READS") -eq 1 ]]
expected=(0 0 0 0)
check_context BUILDKITE_GITHUB_EVENT=pull_request
check_context PROBE_WEBHOOK=''
check_context PROBE_WEBHOOK='{}'
check_context PROBE_WEBHOOK="$(jq '.forced = true' <<< "$PROBE_WEBHOOK")"
check_context PROBE_WEBHOOK="$(jq '.ref = "refs/heads/feature"' <<< "$PROBE_WEBHOOK")"
check_context PROBE_WEBHOOK="$(jq --arg sha "$base" '.after = $sha' <<< "$PROBE_WEBHOOK")"
check_context PROBE_WEBHOOK="$(jq --arg sha "$other_base" '.before = $sha' <<< "$PROBE_WEBHOOK")"

for source in api trigger_job; do
  expected=("${selected_expected[@]}")
  check_context BUILDKITE_SOURCE="$source" CI_CHANGED_FILES_BASE="$base"
  expected=(0 0 0 0)
  check_context BUILDKITE_SOURCE="$source"
  check_context BUILDKITE_SOURCE="$source" CI_CHANGED_FILES_BASE=missing-ci-probe-base
  check_context BUILDKITE_SOURCE="$source" CI_CHANGED_FILES_BASE="$other_base"
  check_context BUILDKITE_SOURCE="$source" CI_CHANGED_FILES_BASE="$base" BUILDKITE_BRANCH=feature
  check_context BUILDKITE_SOURCE="$source" CI_CHANGED_FILES_BASE="$base" BUILDKITE_PULL_REQUEST=123
  check_context BUILDKITE_SOURCE="$source" CI_CHANGED_FILES_BASE="$base" BUILDKITE_TAG=v1.0
  check_context BUILDKITE_SOURCE="$source" CI_CHANGED_FILES_BASE="$base" STUDIO_CI_FULL_BUILD=1
done
for source in ui schedule; do
  check_context BUILDKITE_SOURCE="$source" CI_CHANGED_FILES_BASE="$base"
done
check_context CI_CHANGED_FILES_BASE="$base" BUILDKITE_BRANCH=feature
check_context CI_CHANGED_FILES_BASE="$base" BUILDKITE_TAG=v1.0

# Even a PR-looking subject on a merge commit should run fully without an explicit base.
merge=$(git commit-tree 'HEAD^{tree}' -p "$base" -p "$other_base" -m 'Fixture merge (#1000001)')
git checkout --detach -q "$merge"
set_push "$base"
read_vars
check_values

# Each skipped predecessor should force a full build, even on a docs-only follow-up push.
echo 'Just docs' > marker-follow-up.md
git add marker-follow-up.md
git commit -qm 'Prepare docs-only comparison'
previous_tree=$(git rev-parse 'HEAD^1^{tree}')
followup_tree=$(git rev-parse 'HEAD^{tree}')
for marker in '[ci skip]' '[skip ci]' '[ci-skip]' '[skip-ci]'; do
  previous=$(git commit-tree "$previous_tree" -p "$base" -m 'Previous squash (#1000002)' -m "$marker")
  followup=$(git commit-tree "$followup_tree" -p "$previous" -m 'Follow-up (#1000003)')
  git checkout --detach -q "$followup"
  set_push "$previous"
  read_vars
  check_values
done

# Use the same notifier/upload flow as the central uploader, with a harmless probe job and its own status.
cat > smoke.yml <<'YAML'
steps:
  - label: "Trunk $PROBE_SCENARIO selection"
    command: "echo 'Relevant code selected this job'"
    agents: { queue: upload }
    skip: "$PROBE_SKIP"
    notify:
      - github_commit_status:
          context: "CI trunk probe/$PROBE_SCENARIO"
        even-if-skipped: true
YAML
notify_skipped_steps smoke.yml | buildkite-agent pipeline upload
