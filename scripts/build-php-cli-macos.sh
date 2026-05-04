#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SPC_DIR="${SPC_DIR:-"$ROOT_DIR/.cache/static-php-cli"}"
SPC_TAG="${SPC_TAG:-2.8.5}"
PHP_VERSION="${PHP_VERSION:-8.4.20}"
PHP_MINOR="${PHP_MINOR:-"${PHP_VERSION%.*}"}"
OUTPUT_DIR="${OUTPUT_DIR:-"$ROOT_DIR/out/php-binaries"}"
ARTIFACT_BASENAME="php-${PHP_VERSION}-cli-macos-aarch64"
EXTENSIONS="ctype,curl,dom,exif,fileinfo,filter,gd,iconv,imagick,intl,mbregex,mbstring,mysqli,mysqlnd,opcache,openssl,pdo,pdo_sqlite,phar,session,simplexml,sodium,sqlite3,tokenizer,xml,xmlreader,xmlwriter,zip,zlib"

export PATH="/opt/homebrew/opt/bison/bin:$PATH"

if [[ "$(uname -s)" != "Darwin" ]]; then
	echo "This script builds macOS binaries and must run on macOS." >&2
	exit 1
fi

if [[ "$(uname -m)" != "arm64" ]]; then
	echo "This script must run on a macOS arm64 host." >&2
	exit 1
fi

for command in git composer php python3 shasum tar file; do
	if ! command -v "$command" >/dev/null 2>&1; then
		echo "Missing required command: $command" >&2
		exit 1
	fi
done

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

python3 - "$SPC_DIR" <<'PY'
from pathlib import Path
import sys

root = Path(sys.argv[1])

def replace_once(path, old, new):
    file = root / path
    text = file.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"Could not patch {path}")
    file.write_text(text.replace(old, new, 1))

def ensure_patch(path, marker, replacements):
    file = root / path
    text = file.read_text()
    if marker in text:
        return
    for old, new in replacements:
        if old in text:
            file.write_text(text.replace(old, new, 1))
            return
    raise SystemExit(f"Could not patch {path}")

replace_once(
    "src/SPC/util/executor/UnixCMakeExecutor.php",
    """        $target_arch = arch2gnu(php_uname('m'));
        $cflags = getenv('SPC_DEFAULT_C_FLAGS');
""",
    """        $target_arch = arch2gnu(php_uname('m'));
        $target_mac_arch = match ($target_arch) {
            'aarch64' => 'arm64',
            default => $target_arch,
        };
        $cflags = getenv('SPC_DEFAULT_C_FLAGS');
""",
)
ensure_patch(
    "src/SPC/util/executor/UnixCMakeExecutor.php",
    'CMAKE_OSX_ARCHITECTURES \\"{$target_mac_arch}\\"',
    [
        (
            '            $toolchain .= "\\nset(CMAKE_OSX_ARCHITECTURES \\"{$target_arch}\\" CACHE STRING \\"\\" FORCE)";',
            '            $toolchain .= "\\nset(CMAKE_OSX_ARCHITECTURES \\"{$target_mac_arch}\\" CACHE STRING \\"\\" FORCE)";',
        ),
        (
            """CMAKE;
        // Whoops, linux may need CMAKE_AR sometimes
""",
            """CMAKE;
        if (PHP_OS_FAMILY === 'Darwin') {
            $toolchain .= "\\nset(CMAKE_OSX_ARCHITECTURES \\"{$target_mac_arch}\\" CACHE STRING \\"\\" FORCE)";
        }
        // Whoops, linux may need CMAKE_AR sometimes
""",
        ),
    ],
)
ensure_patch(
    "src/SPC/util/SPCConfigUtil.php",
    "$libs = str_replace('-lstdc++', '', $libs);",
    [
        (
            """        if ($this->hasCpp($extensions, $libraries)) {
            $libcpp = SPCTarget::getTargetOS() === 'Darwin' ? '-lc++' : '-lstdc++';
            $libs = str_replace($libcpp, '', $libs) . " {$libcpp}";
        }
""",
            """        if ($this->hasCpp($extensions, $libraries)) {
            $isDarwin = SPCTarget::getTargetOS() === 'Darwin';
            $libcpp = $isDarwin ? '-lc++' : '-lstdc++';
            $libs = str_replace($libcpp, '', $libs);
            if ($isDarwin) {
                $libs = str_replace('-lstdc++', '', $libs);
            }
            $libs .= " {$libcpp}";
        }
""",
        ),
    ],
)
PY

php bin/spc download --with-php="$PHP_MINOR" --for-extensions="$EXTENSIONS" --retry=2

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
env "${SPC_ENV[@]}" php bin/spc build "$EXTENSIONS" --build-cli --with-suggested-libs

PHP_BIN="$BUILD_ROOT/bin/php"

if [[ ! -x "$PHP_BIN" ]]; then
	echo "PHP binary was not built at $PHP_BIN" >&2
	exit 1
fi

file "$PHP_BIN"
"$PHP_BIN" --version | grep -q "PHP $PHP_VERSION "

modules="$("$PHP_BIN" -m)"
expected_modules=(
	ctype curl dom exif fileinfo filter gd iconv imagick intl mbstring mysqli mysqlnd
	"Zend OPcache" openssl PDO pdo_sqlite Phar session SimpleXML sodium sqlite3
	tokenizer xml xmlreader xmlwriter zip zlib
)
excluded_modules=(redis apcu bcmath pdo_mysql pgsql imap soap sockets ftp)

for module in "${expected_modules[@]}"; do
	if ! grep -Fxq "$module" <<<"$modules"; then
		echo "Expected PHP module missing: $module" >&2
		exit 1
	fi
done

for module in "${excluded_modules[@]}"; do
	if grep -Fxq "$module" <<<"$modules"; then
		echo "Unexpected PHP module present: $module" >&2
		exit 1
	fi
done

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
