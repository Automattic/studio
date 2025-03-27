#!/bin/sh

# Exit if any command fails
set -e

if [ -z "$CLI_SYMLINK_PATH" ] || [ -z "$CLI_TARGET_PATH" ]; then
	echo "Error: CLI_SYMLINK_PATH and CLI_TARGET_PATH environment variables must be set"
	exit 1
fi

DIRECTORY_PATH=$(dirname "$CLI_SYMLINK_PATH")

rm -f "$CLI_SYMLINK_PATH"
mkdir -p "$DIRECTORY_PATH"
ln -s "$CLI_TARGET_PATH" "$CLI_SYMLINK_PATH"
