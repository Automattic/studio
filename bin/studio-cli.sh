#!/bin/sh

# This script is assumed to live in `/Applications/Studio.app/Contents/Resources/bin/studio-cli.sh`
CONTENTS_DIR=$(dirname "$(dirname "$(dirname "$(realpath "$0")")")")
ELECTRON_EXECUTABLE="$CONTENTS_DIR/MacOS/Studio"
CLI_SCRIPT="$CONTENTS_DIR/Resources/cli/main.js"

if ! [ -x "$ELECTRON_EXECUTABLE" ]; then
	echo >&2 "'Studio' executable not found"
	exit 1
fi

ELECTRON_RUN_AS_NODE=1 exec "$ELECTRON_EXECUTABLE" "$CLI_SCRIPT" "$@"
