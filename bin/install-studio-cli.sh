#!/bin/sh

# Exit if any command fails
set -e

if [ -z "$INSTALLED_CLI_PATH" ] || [ -z "$PACKAGED_PATH" ]; then
	echo "Error: INSTALLED_CLI_PATH and PACKAGED_PATH environment variables must be set"
	exit 1
fi

DIRECTORY_PATH=$(dirname "$INSTALLED_CLI_PATH")

rm -f "$INSTALLED_CLI_PATH"
mkdir -p "$DIRECTORY_PATH"
ln -s "$PACKAGED_PATH" "$INSTALLED_CLI_PATH"
