#!/bin/sh

# The least terrible way to resolve a symlink to its real path.
function realpath() {
  /usr/bin/perl -e "use Cwd;print Cwd::abs_path(@ARGV[0])" "$0";
}

# This script is assumed to live in `/Applications/Studio.app/Contents/Resources/bin/studio-cli.sh`
CONTENTS_DIR="$(command dirname "$(command dirname "$(command dirname "$(realpath "$0")")")")"
BINARY_NAME="$(TERM=dumb command ls "$CONTENTS_DIR/MacOS/")"
ELECTRON="$CONTENTS_DIR/MacOS/$BINARY_NAME"
CLI="$CONTENTS_DIR/Resources/cli/main.js"

ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$CLI" "$@"

exit $? 