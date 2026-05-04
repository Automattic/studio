#!/usr/bin/env bash

set -euo pipefail

WATCHED_FILES=(
	"scripts/build-php-cli-macos.sh"
	".buildkite/commands/run-php-cli-macos-arm64-build.sh"
)

changed_files() {
	if [[ "${BUILDKITE_PULL_REQUEST:-false}" != "false" && -n "${BUILDKITE_PULL_REQUEST_BASE_BRANCH:-}" ]]; then
		local base_branch="$BUILDKITE_PULL_REQUEST_BASE_BRANCH"
		git fetch --quiet origin "$base_branch:refs/remotes/origin/$base_branch"
		git diff --name-only "origin/$base_branch"...HEAD
		return
	fi

	git diff --name-only HEAD^ HEAD
}

should_run=false
while IFS= read -r file; do
	for watched_file in "${WATCHED_FILES[@]}"; do
		if [[ "$file" == "$watched_file" ]]; then
			should_run=true
			break 2
		fi
	done
done < <(changed_files)

if [[ "$should_run" != "true" ]]; then
	echo "Skipping PHP CLI macOS arm64 build; watched files did not change."
	exit 0
fi

if [[ "$(uname -m)" != "arm64" ]]; then
	echo "PHP CLI macOS arm64 build must run on an arm64 macOS agent." >&2
	exit 1
fi

bash scripts/build-php-cli-macos.sh
