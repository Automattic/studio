#!/bin/sh

# This script is used to install the Studio CLI on macOS. It creates a symlink at CLI_SYMLINK_PATH
# (e.g. /usr/local/bin/studio) pointing to the packaged Studio CLI JS file at CLI_PACKAGED_PATH.

# Exit if any command fails
set -e

if [ -z "$CLI_SYMLINK_PATH" ] || [ -z "$CLI_PACKAGED_PATH" ]; then
	echo >&2 "Error: CLI_SYMLINK_PATH and CLI_PACKAGED_PATH environment variables must be set"
	exit 1
fi

CLI_DIRECTORY_PATH=$(dirname "$CLI_SYMLINK_PATH")

[ -h "$CLI_SYMLINK_PATH" ] && rm "$CLI_SYMLINK_PATH"
mkdir -p "$CLI_DIRECTORY_PATH"
ln -s "$CLI_PACKAGED_PATH" "$CLI_SYMLINK_PATH"
