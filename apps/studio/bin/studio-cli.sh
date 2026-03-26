#!/bin/sh

# The assumption is that this script lives in `/Applications/Studio.app/Contents/Resources/bin/studio-cli.sh`
BIN_DIR=$(dirname "$(realpath "$0")")
BUNDLED_NODE_EXECUTABLE="$BIN_DIR/node"
CONTENTS_DIR=$(dirname "$(dirname "$BIN_DIR")")
CLI_SCRIPT="$CONTENTS_DIR/Resources/cli/main.js"

if [ -x "$BUNDLED_NODE_EXECUTABLE" ]; then
	# Prevent node from printing warnings about NODE_OPTIONS being ignored
	unset NODE_OPTIONS
	exec "$BUNDLED_NODE_EXECUTABLE" --experimental-wasm-jspi "$CLI_SCRIPT" "$@"
else
	# If the default script path is not found, assume that this script lives in the development directory
	# and look for the CLI JS bundle in the `./dist` directory
	if ! [ -f "$CLI_SCRIPT" ]; then
		STUDIO_DIR=$(dirname "$(dirname "$(realpath "$0")")")
		CLI_SCRIPT="$(dirname "$STUDIO_DIR")/cli/dist/cli/main.js"
	fi

	# Prevent node from printing warnings about NODE_OPTIONS being ignored
	unset NODE_OPTIONS
	exec node --experimental-wasm-jspi "$CLI_SCRIPT" "$@"
fi
