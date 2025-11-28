#!/bin/sh

# The default assumption is that this script lives in `/Applications/Studio.app/Contents/Resources/bin/studio-cli.sh`
CONTENTS_DIR=$(dirname "$(dirname "$(dirname "$(realpath "$0")")")")
ELECTRON_EXECUTABLE="$CONTENTS_DIR/MacOS/Studio"
CLI_SCRIPT="$CONTENTS_DIR/Resources/cli/main.js"

if [ -x "$ELECTRON_EXECUTABLE" ]; then
	# Prevent node from printing warnings about NODE_OPTIONS being ignored
	unset NODE_OPTIONS
	ELECTRON_RUN_AS_NODE=1 exec "$ELECTRON_EXECUTABLE" "$CLI_SCRIPT" "$@"
else
	# If the default script path is not found, assume that this script lives in the development directory
	# and look for the CLI JS bundle in the `./dist` directory
	if ! [ -f "$CLI_SCRIPT" ]; then
		SCRIPT_DIR=$(dirname $(dirname "$(realpath "$0")"))
		CLI_SCRIPT="$SCRIPT_DIR/dist/cli/main.js"
	fi

	# Prevent node from printing warnings about NODE_OPTIONS being ignored
	unset NODE_OPTIONS
	exec node "$CLI_SCRIPT" "$@"
fi
