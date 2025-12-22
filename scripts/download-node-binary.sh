#!/bin/bash
set -e

# Download Node.js binary for bundling with Studio
# Usage: ./scripts/download-node-binary.sh <platform> <arch>
# Example: ./scripts/download-node-binary.sh darwin arm64

NODE_VERSION="v22.12.0"  # LTS version
PLATFORM="${1:-darwin}"
ARCH="${2:-arm64}"

# Map architecture names
case "$ARCH" in
  arm64) NODE_ARCH="arm64" ;;
  x64)   NODE_ARCH="x64" ;;
  *)     echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

# Map platform names
case "$PLATFORM" in
  darwin) NODE_PLATFORM="darwin" ;;
  win32)  NODE_PLATFORM="win" ;;
  linux)  NODE_PLATFORM="linux" ;;
  *)      echo "Unsupported platform: $PLATFORM"; exit 1 ;;
esac

BIN_DIR="$(dirname "$0")/../bin"
mkdir -p "$BIN_DIR"

if [ "$NODE_PLATFORM" = "win" ]; then
  FILENAME="node-${NODE_VERSION}-${NODE_PLATFORM}-${NODE_ARCH}.zip"
  URL="https://nodejs.org/dist/${NODE_VERSION}/${FILENAME}"

  echo "Downloading Node.js ${NODE_VERSION} for ${NODE_PLATFORM}-${NODE_ARCH}..."
  curl -L "$URL" -o "/tmp/${FILENAME}"

  echo "Extracting node.exe..."
  unzip -j "/tmp/${FILENAME}" "node-${NODE_VERSION}-${NODE_PLATFORM}-${NODE_ARCH}/node.exe" -d "$BIN_DIR"
  rm "/tmp/${FILENAME}"
else
  FILENAME="node-${NODE_VERSION}-${NODE_PLATFORM}-${NODE_ARCH}.tar.gz"
  URL="https://nodejs.org/dist/${NODE_VERSION}/${FILENAME}"

  echo "Downloading Node.js ${NODE_VERSION} for ${NODE_PLATFORM}-${NODE_ARCH}..."
  curl -L "$URL" -o "/tmp/${FILENAME}"

  echo "Extracting node binary..."
  tar -xzf "/tmp/${FILENAME}" -C /tmp
  cp "/tmp/node-${NODE_VERSION}-${NODE_PLATFORM}-${NODE_ARCH}/bin/node" "$BIN_DIR/node"
  chmod +x "$BIN_DIR/node"
  rm -rf "/tmp/${FILENAME}" "/tmp/node-${NODE_VERSION}-${NODE_PLATFORM}-${NODE_ARCH}"
fi

echo "Node.js binary installed to $BIN_DIR"
ls -la "$BIN_DIR"
