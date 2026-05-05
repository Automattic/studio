#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SPC_DIR="${SPC_DIR:-"$ROOT_DIR/.cache/static-php-cli"}"
SPC_TAG="${SPC_TAG:-2.8.5}"
CRAFT_FILE="$ROOT_DIR/scripts/php-cli.craft.yml"
OUTPUT_DIR="${OUTPUT_DIR:-"$ROOT_DIR/out/php-binaries"}"
SPC_PATCH="$ROOT_DIR/scripts/static-php-cli-macos-arm64.patch"
PHP_HOST_FORMULA="${PHP_HOST_FORMULA:-php@8.4}"

WATCHED_FILES=(
	"scripts/php-cli.craft.yml"
	"scripts/static-php-cli-macos-arm64.patch"
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

should_run_build() {
	if [[ "${BUILDKITE:-false}" != "true" ]]; then
		return 0
	fi

	while IFS= read -r file; do
		for watched_file in "${WATCHED_FILES[@]}"; do
			if [[ "$file" == "$watched_file" ]]; then
				return 0
			fi
		done
	done < <(changed_files)

	return 1
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
	local log_dir="$SPC_DIR/log"

	if [[ ! -d "$log_dir" ]]; then
		return
	fi

	mkdir -p "$OUTPUT_DIR"
	for log_file in "$log_dir"/spc.output.log "$log_dir"/spc.shell.log; do
		if [[ -f "$log_file" ]]; then
			cp "$log_file" "$OUTPUT_DIR/"
		fi
	done
}

trap copy_spc_logs_to_artifacts ERR

cd "$ROOT_DIR"

if ! should_run_build; then
	echo "Skipping PHP CLI macOS arm64 build; watched files did not change."
	exit 0
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
	echo "PHP CLI macOS arm64 build must run on macOS." >&2
	exit 1
fi

if [[ "$(uname -m)" != "arm64" ]]; then
	echo "PHP CLI macOS arm64 build must run on an arm64 macOS agent." >&2
	exit 1
fi

install_brew_formula "$PHP_HOST_FORMULA"
export PATH="/opt/homebrew/opt/$PHP_HOST_FORMULA/bin:/opt/homebrew/opt/$PHP_HOST_FORMULA/sbin:$PATH"

install_brew_formula_if_missing composer composer
install_brew_formula_if_missing re2c re2c
install_brew_formula_if_missing autoconf autoconf
install_brew_formula_if_missing automake automake
install_brew_formula_if_missing cmake cmake
install_brew_formula_if_missing glibtoolize libtool
install_brew_formula_if_missing xz xz
install_brew_formula bison

for command in awk git composer php patch shasum tar file; do
	if ! command -v "$command" >/dev/null 2>&1; then
		echo "Missing required command: $command" >&2
		exit 1
	fi
done

PHP_VERSION="$(awk -F ': *' '$1 == "php-version" { print $2; exit }' "$CRAFT_FILE")"
if [[ -z "$PHP_VERSION" ]]; then
	echo "Could not read php-version from $CRAFT_FILE." >&2
	exit 1
fi
PHP_MINOR="${PHP_VERSION%.*}"
ARTIFACT_BASENAME="php-${PHP_VERSION}-cli-macos-aarch64"

host_php_minor="$(php -r 'echo PHP_MAJOR_VERSION . "." . PHP_MINOR_VERSION;')"
if [[ "$host_php_minor" != "$PHP_MINOR" ]]; then
	echo "Host PHP must be $PHP_MINOR; found $host_php_minor at $(command -v php)." >&2
	exit 1
fi

if [[ ! -d "$SPC_DIR/.git" ]]; then
	git clone --depth 1 --branch "$SPC_TAG" https://github.com/crazywhalecc/static-php-cli.git "$SPC_DIR"
else
	git -C "$SPC_DIR" fetch --depth 1 origin "$SPC_TAG"
	git -C "$SPC_DIR" checkout --detach FETCH_HEAD
	git -C "$SPC_DIR" reset --hard
fi

cd "$SPC_DIR"
composer install --no-dev --no-interaction --prefer-dist

# static-php-cli 2.8.5 needs these macOS arm64 fixes until they land upstream.
patch -p1 < "$SPC_PATCH"

BUILD_ROOT="$SPC_DIR/buildroot-arm64"
SOURCE_PATH="$SPC_DIR/source-arm64"
PKG_ROOT="$SPC_DIR/pkgroot/aarch64-darwin"
SPC_ENV=(
	"BUILD_ROOT_PATH=$BUILD_ROOT"
	"SOURCE_PATH=$SOURCE_PATH"
	"PKG_ROOT_PATH=$PKG_ROOT"
)

rm -rf "$BUILD_ROOT" "$SOURCE_PATH"

env "${SPC_ENV[@]}" php bin/spc install-pkg pkg-config
env "${SPC_ENV[@]}" php bin/spc doctor --auto-fix=never
env "${SPC_ENV[@]}" php bin/spc craft "$CRAFT_FILE"

PHP_BIN="$BUILD_ROOT/bin/php"

if [[ ! -x "$PHP_BIN" ]]; then
	echo "PHP binary was not built at $PHP_BIN" >&2
	exit 1
fi

file "$PHP_BIN"
"$PHP_BIN" --version | grep -q "PHP $PHP_VERSION "

mkdir -p "$OUTPUT_DIR"
artifact_path="$OUTPUT_DIR/$ARTIFACT_BASENAME.tar.gz"
hash_path="$artifact_path.sha256"
package_dir="$(mktemp -d)"
trap 'rm -rf "$package_dir"' EXIT

cp "$PHP_BIN" "$package_dir/php"
chmod 755 "$package_dir/php"
rm -f "$artifact_path" "$hash_path"
tar -czf "$artifact_path" -C "$package_dir" php
shasum -a 256 "$artifact_path" | awk '{print $1}' > "$hash_path"

echo "Created $artifact_path"
echo "Created $hash_path"
