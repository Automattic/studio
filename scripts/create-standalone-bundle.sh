#!/bin/sh
set -eu

# Creates a standalone Studio CLI bundle for the current platform.
# Output: standalone-bundles/studio-cli-{platform}-{arch}.tar.gz
#
# Prerequisites: Node.js >= 22, npm dependencies installed
#
# Usage:
#   bash scripts/create-standalone-bundle.sh
#   bash scripts/create-standalone-bundle.sh darwin arm64   # cross-platform

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Platform detection (allow overrides via args)
if [ $# -ge 2 ]; then
	PLATFORM="$1"
	ARCH="$2"
else
	OS="$(uname -s)"
	case "$OS" in
		Darwin) PLATFORM="darwin" ;;
		Linux)  PLATFORM="linux" ;;
		*)      echo "Error: Unsupported OS: $OS" >&2; exit 1 ;;
	esac

	MACHINE="$(uname -m)"
	case "$MACHINE" in
		x86_64|amd64)  ARCH="x64" ;;
		arm64|aarch64) ARCH="arm64" ;;
		*)             echo "Error: Unsupported arch: $MACHINE" >&2; exit 1 ;;
	esac
fi

BUNDLE_NAME="studio-cli-${PLATFORM}-${ARCH}"
OUTPUT_DIR="$REPO_ROOT/standalone-bundles"
BUNDLE_DIR="$OUTPUT_DIR/$BUNDLE_NAME"
NODE_BIN_DIR="$REPO_ROOT/apps/studio/bin"

echo "==> Building standalone bundle: $BUNDLE_NAME"
echo ""

# Step 1: Build CLI with bundled node_modules
echo "==> Step 1/4: Building CLI package..."
npm run cli:package

# Step 2: Download Node binary for target platform
echo ""
echo "==> Step 2/4: Downloading Node.js binary for $PLATFORM-$ARCH..."
npx ts-node scripts/download-node-binary.ts "$PLATFORM" "$ARCH"

# Step 3: Assemble bundle
echo ""
echo "==> Step 3/4: Assembling bundle..."
rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR/bin"
mkdir -p "$BUNDLE_DIR/cli"

# Copy Node binary
if [ "$PLATFORM" = "win32" ]; then
	cp "$NODE_BIN_DIR/node.exe" "$BUNDLE_DIR/bin/node.exe"
else
	cp "$NODE_BIN_DIR/node" "$BUNDLE_DIR/bin/node"
	chmod +x "$BUNDLE_DIR/bin/node"
fi

# Copy CLI bundle
cp -R "$REPO_ROOT/apps/cli/dist/cli/." "$BUNDLE_DIR/cli/"

# Copy launcher script
if [ "$PLATFORM" = "win32" ]; then
	cp "$REPO_ROOT/scripts/standalone/studio.cmd" "$BUNDLE_DIR/bin/studio.cmd"
else
	cp "$REPO_ROOT/scripts/standalone/studio" "$BUNDLE_DIR/bin/studio"
	chmod +x "$BUNDLE_DIR/bin/studio"
fi

# Step 4: Compress
echo ""
echo "==> Step 4/4: Compressing..."
cd "$OUTPUT_DIR"
if [ "$PLATFORM" = "win32" ]; then
	zip -rq "$BUNDLE_NAME.zip" "$BUNDLE_NAME"
	ARCHIVE="$BUNDLE_NAME.zip"
else
	tar -czf "$BUNDLE_NAME.tar.gz" "$BUNDLE_NAME"
	ARCHIVE="$BUNDLE_NAME.tar.gz"
fi
rm -rf "$BUNDLE_DIR"

BUNDLE_SIZE=$(du -sh "$OUTPUT_DIR/$ARCHIVE" | cut -f1)
echo ""
echo "==> Done! Bundle: $OUTPUT_DIR/$ARCHIVE ($BUNDLE_SIZE)"
