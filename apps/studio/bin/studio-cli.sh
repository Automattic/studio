#!/bin/sh

# In production, this script lives alongside the standalone CLI binary under the Electron
# app's resources directory:
#   macOS: /Applications/Studio.app/Contents/Resources/bin/studio-cli.sh
#   Linux: /usr/lib/studio/resources/bin/studio-cli.sh
#
# In development, it falls back to the CLI script with system Node.
BIN_DIR=$(dirname "$(realpath "$0")")
CLI_BINARY="$BIN_DIR/studio"
CONTENTS_DIR=$(dirname "$(dirname "$BIN_DIR")")
CLI_SCRIPT="$CONTENTS_DIR/Resources/cli/main.mjs"

if [ -x "$CLI_BINARY" ]; then
	# Note: Node's SEA startup skips CLI flag parsing, so we can't enable
	# --experimental-wasm-jspi here. PHP-WASM falls back to asyncify.
	unset NODE_OPTIONS
	exec "$CLI_BINARY" "$@"
fi

# Development fallback: use system Node with the CLI script
if ! [ -f "$CLI_SCRIPT" ]; then
	STUDIO_DIR=$(dirname "$(dirname "$(realpath "$0")")")
	CLI_SCRIPT="$(dirname "$STUDIO_DIR")/cli/dist/cli/main.mjs"
fi

unset NODE_OPTIONS
exec node --experimental-wasm-jspi "$CLI_SCRIPT" "$@"
