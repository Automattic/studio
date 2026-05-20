#!/bin/sh

# In production, this script lives alongside the `cli/` directory under the
# Electron app's resources directory:
#   macOS: /Applications/Studio.app/Contents/Resources/bin/studio-cli.sh
#   Linux: /usr/lib/studio/resources/bin/studio-cli.sh
# The Studio CLI used to ship its own bundled `node` binary next to this
# script. It now runs against the Electron runtime via ELECTRON_RUN_AS_NODE=1,
# so we locate the Electron executable instead.
BIN_DIR=$(dirname "$(realpath "$0")")
CLI_SCRIPT="$(dirname "$BIN_DIR")/cli/main.mjs"

# Electron binary candidates, ordered by platform layout:
#   - macOS: <BIN_DIR>/../../MacOS/Studio
#   - Linux (deb): <BIN_DIR>/../../studio
ELECTRON_BIN=""
for candidate in \
	"$(dirname "$(dirname "$BIN_DIR")")/MacOS/Studio" \
	"$(dirname "$(dirname "$BIN_DIR")")/studio" \
	"$(dirname "$(dirname "$BIN_DIR")")/Studio"
do
	if [ -x "$candidate" ]; then
		ELECTRON_BIN="$candidate"
		break
	fi
done

if [ -n "$ELECTRON_BIN" ]; then
	# Prevent node from printing warnings about NODE_OPTIONS being ignored
	unset NODE_OPTIONS
	ELECTRON_RUN_AS_NODE=1 exec "$ELECTRON_BIN" "$CLI_SCRIPT" "$@"
fi

# Development fallback: when invoked from the source tree, run the system
# node against the dev build of the CLI.
if ! [ -f "$CLI_SCRIPT" ]; then
	STUDIO_DIR=$(dirname "$(dirname "$(realpath "$0")")")
	CLI_SCRIPT="$(dirname "$STUDIO_DIR")/cli/dist/cli/main.mjs"
fi

# Prevent node from printing warnings about NODE_OPTIONS being ignored
unset NODE_OPTIONS
exec node "$CLI_SCRIPT" "$@"
