#!/bin/sh

# This script is used to install the Studio CLI on macOS. It creates a symlink at CLI_SYMLINK_SOURCE
# (e.g. /usr/local/bin/studio) pointing to the packaged Studio CLI JS file at CLI_SYMLINK_TARGET.

# Exit if any command fails
set -e

if [ -z "$CLI_SYMLINK_SOURCE" ] || [ -z "$CLI_SYMLINK_TARGET" ]; then
	echo "Error: CLI_SYMLINK_SOURCE and CLI_SYMLINK_TARGET environment variables must be set"
	exit 1
fi

DIRECTORY_PATH=$(dirname "$CLI_SYMLINK_SOURCE")

rm -f "$CLI_SYMLINK_SOURCE"
mkdir -p "$DIRECTORY_PATH"
ln -s "$CLI_SYMLINK_TARGET" "$CLI_SYMLINK_SOURCE"
