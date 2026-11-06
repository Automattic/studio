#!/bin/sh

# In production, this script lives alongside `node` and the `cli/` directory under the Electron
# app's resources directory:
#   macOS: /Applications/Studio.app/Contents/Resources/bin/studio-cli.sh
#   Linux: /usr/lib/studio/resources/bin/studio-cli.sh
BIN_DIR=$(dirname "$(realpath "$0")")
INSTALL_DIR=$(dirname "$BIN_DIR")
if [ -f "$INSTALL_DIR/cli/version" ]; then
	INSTALLED_VERSION=$(cat "$INSTALL_DIR/cli/version")
	CURRENT_FILE="$INSTALL_DIR/cli-versions/current-$INSTALLED_VERSION"
	if [ -f "$CURRENT_FILE" ]; then
		CURRENT_VERSION=$(cat "$CURRENT_FILE")
		case "$CURRENT_VERSION" in
			''|*[!0-9A-Za-z.+-]*) ;;
			*)
				UPDATED_DIR="$INSTALL_DIR/cli-versions/$CURRENT_VERSION"
				if [ -x "$UPDATED_DIR/bin/node" ] && [ -f "$UPDATED_DIR/cli/main.mjs" ]; then
					BIN_DIR="$UPDATED_DIR/bin"
				fi
				;;
		esac
	fi
fi
BUNDLED_NODE_EXECUTABLE="$BIN_DIR/node"
CLI_SCRIPT="$(dirname "$BIN_DIR")/cli/main.mjs"

if [ -x "$BUNDLED_NODE_EXECUTABLE" ]; then
	# Prevent node from printing warnings about NODE_OPTIONS being ignored
	unset NODE_OPTIONS
	exec "$BUNDLED_NODE_EXECUTABLE" "$CLI_SCRIPT" "$@"
else
	# If the default script path is not found, assume that this script lives in the development directory
	# and look for the CLI JS bundle in the `./dist` directory
	if ! [ -f "$CLI_SCRIPT" ]; then
		STUDIO_DIR=$(dirname "$(dirname "$(realpath "$0")")")
		CLI_SCRIPT="$(dirname "$STUDIO_DIR")/cli/dist/cli/main.mjs"
	fi

	# Prevent node from printing warnings about NODE_OPTIONS being ignored
	unset NODE_OPTIONS
	exec node "$CLI_SCRIPT" "$@"
fi
