#!/bin/sh

# In production, this script lives alongside `node` and the `cli/` directory under the Electron
# app's resources directory:
#   macOS: /Applications/Studio.app/Contents/Resources/bin/studio-cli.sh
#   Linux: /usr/lib/studio/resources/bin/studio-cli.sh
BIN_DIR=$(dirname "$(realpath "$0")")
BUNDLED_NODE_EXECUTABLE="$BIN_DIR/node"
CLI_SCRIPT="$(dirname "$BIN_DIR")/cli/main.mjs"

if [ -x "$BUNDLED_NODE_EXECUTABLE" ]; then
	# Prevent node from printing warnings about NODE_OPTIONS being ignored
	unset NODE_OPTIONS
	exec "$BUNDLED_NODE_EXECUTABLE" --experimental-wasm-jspi "$CLI_SCRIPT" "$@"
else
	# If the default script path is not found, assume that this script lives in the development directory
	# and look for the CLI JS bundle in the `./dist` directory
	if ! [ -f "$CLI_SCRIPT" ]; then
		STUDIO_DIR=$(dirname "$(dirname "$(realpath "$0")")")
		CLI_SCRIPT="$(dirname "$STUDIO_DIR")/cli/dist/cli/main.mjs"
	fi

	# Prevent node from printing warnings about NODE_OPTIONS being ignored
	unset NODE_OPTIONS
	exec node --experimental-wasm-jspi "$CLI_SCRIPT" "$@"
fi
