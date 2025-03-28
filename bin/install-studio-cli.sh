#!/bin/sh

# This script is used to install the Studio CLI on macOS. It creates a symlink at CLI_SYMLINK_PATH
# (e.g. /usr/local/bin/studio) pointing to the packaged Studio CLI JS file at CLI_SYMLINK_DESTINATION.

# Exit if any command fails
set -e

if [ -z "$CLI_SYMLINK_PATH" ] || [ -z "$CLI_SYMLINK_DESTINATION" ]; then
	echo >&2 "Error: CLI_SYMLINK_PATH and CLI_SYMLINK_DESTINATION environment variables must be set"
	exit 1
fi

DIRECTORY_PATH=$(dirname "$CLI_SYMLINK_PATH")

rm -f "$CLI_SYMLINK_PATH"
mkdir -p "$DIRECTORY_PATH"
ln -s "$CLI_SYMLINK_DESTINATION" "$CLI_SYMLINK_PATH"
