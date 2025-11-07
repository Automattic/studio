#!/bin/sh

# This script is used to uninstall the Studio CLI on macOS. It removes the symlink at
# CLI_SYMLINK_PATH (e.g. /usr/local/bin/studio)

# Exit if any command fails
set -e

if [ -z "$CLI_SYMLINK_PATH" ]; then
	echo >&2 "Error: CLI_SYMLINK_PATH environment variable must be set"
	exit 1
fi

rm "$CLI_SYMLINK_PATH"
