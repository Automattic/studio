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

install_brew_formula_if_missing() {
	local command_name="$1"
	local formula_name="$2"

	if command -v "$command_name" >/dev/null 2>&1; then
		return
	fi

	install_brew_formula "$formula_name"
}

install_brew_formula() {
	local formula_name="$1"

	if ! command -v brew >/dev/null 2>&1; then
		echo "Missing required Homebrew formula: $formula_name, and Homebrew is unavailable to install it." >&2
		exit 1
	fi

	if brew list --formula "$formula_name" >/dev/null 2>&1; then
		return
	fi

	echo "--- :homebrew: Installing $formula_name"
	brew install "$formula_name"
}

copy_spc_logs_to_artifacts() {
	local log_dir=".cache/static-php-cli/log"
	local output_dir="out/php-binaries"

	if [[ ! -d "$log_dir" ]]; then
		return
	fi

	mkdir -p "$output_dir"
	for log_file in "$log_dir"/spc.output.log "$log_dir"/spc.shell.log; do
		if [[ -f "$log_file" ]]; then
			cp "$log_file" "$output_dir/"
		fi
	done
}

trap copy_spc_logs_to_artifacts ERR

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

install_brew_formula_if_missing composer composer
install_brew_formula_if_missing php php
install_brew_formula_if_missing re2c re2c
install_brew_formula_if_missing autoconf autoconf
install_brew_formula_if_missing automake automake
install_brew_formula_if_missing cmake cmake
install_brew_formula_if_missing glibtoolize libtool
install_brew_formula_if_missing xz xz
install_brew_formula bison

bash scripts/build-php-cli-macos.sh
