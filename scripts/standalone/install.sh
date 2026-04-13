#!/bin/sh
set -eu

# Studio CLI installer
# Usage: curl -fsSL https://wp.build/install.sh | bash
#
# Environment variables:
#   STUDIO_CLI_HOME    — Installation directory (default: ~/.studio)
#   STUDIO_CLI_URL     — Base URL for downloading bundles (default: https://wp.build/releases)

INSTALL_DIR="${STUDIO_CLI_HOME:-$HOME/.studio}"
BASE_URL="${STUDIO_CLI_URL:-https://wp.build/releases}"
BIN_DIR="$HOME/.local/bin"

# --- Platform detection ---

detect_platform() {
	OS="$(uname -s)"
	ARCH="$(uname -m)"

	case "$OS" in
		Darwin) PLATFORM="darwin" ;;
		Linux)  PLATFORM="linux" ;;
		*)
			echo "Error: Unsupported operating system: $OS" >&2
			echo "Studio CLI supports macOS and Linux. For Windows, use install.ps1" >&2
			exit 1
			;;
	esac

	case "$ARCH" in
		x86_64|amd64)  ARCH="x64" ;;
		arm64|aarch64) ARCH="arm64" ;;
		*)
			echo "Error: Unsupported architecture: $ARCH" >&2
			exit 1
			;;
	esac

	echo "Detected platform: $PLATFORM-$ARCH"
}

# --- Download ---

download() {
	URL="$1"
	DEST="$2"

	# Support local file paths for testing
	case "$URL" in
		/*)
			cp "$URL" "$DEST"
			return
			;;
	esac

	if command -v curl >/dev/null 2>&1; then
		curl -fsSL "$URL" -o "$DEST"
	elif command -v wget >/dev/null 2>&1; then
		wget -qO "$DEST" "$URL"
	else
		echo "Error: curl or wget is required to download Studio CLI" >&2
		exit 1
	fi
}

# --- Install ---

install_studio() {
	BUNDLE_NAME="studio-cli-${PLATFORM}-${ARCH}.tar.gz"
	BUNDLE_URL="${BASE_URL}/${BUNDLE_NAME}"
	TMP_DIR="$(mktemp -d)"

	echo "Downloading Studio CLI..."
	download "$BUNDLE_URL" "$TMP_DIR/$BUNDLE_NAME"

	echo "Installing to $INSTALL_DIR..."
	# Extract to temp location first, then replace only bin/ and cli/
	# to preserve existing config files (cli.json, shared.json, certificates, etc.)
	EXTRACT_DIR="$(mktemp -d)"
	tar -xzf "$TMP_DIR/$BUNDLE_NAME" -C "$EXTRACT_DIR" --strip-components=1

	mkdir -p "$INSTALL_DIR"
	rm -rf "$INSTALL_DIR/bin" "$INSTALL_DIR/cli"
	mv "$EXTRACT_DIR/bin" "$INSTALL_DIR/bin"
	mv "$EXTRACT_DIR/cli" "$INSTALL_DIR/cli"
	rm -rf "$EXTRACT_DIR"

	chmod +x "$INSTALL_DIR/bin/node"
	chmod +x "$INSTALL_DIR/bin/studio"

	rm -rf "$TMP_DIR"

	# Symlink to PATH
	mkdir -p "$BIN_DIR"
	ln -sf "$INSTALL_DIR/bin/studio" "$BIN_DIR/studio"
}

# --- PATH setup ---

ensure_path() {
	case ":${PATH}:" in
		*":${BIN_DIR}:"*) return ;;
	esac

	SHELL_NAME="$(basename "$SHELL")"
	case "$SHELL_NAME" in
		zsh)  RC_FILE="$HOME/.zshrc" ;;
		bash) RC_FILE="$HOME/.bashrc" ;;
		fish) RC_FILE="$HOME/.config/fish/config.fish" ;;
		*)    RC_FILE="$HOME/.profile" ;;
	esac

	if [ "$SHELL_NAME" = "fish" ]; then
		PATH_LINE="set -gx PATH \"$BIN_DIR\" \$PATH"
	else
		PATH_LINE="export PATH=\"$BIN_DIR:\$PATH\""
	fi

	if [ -f "$RC_FILE" ] && grep -qF "$BIN_DIR" "$RC_FILE" 2>/dev/null; then
		return
	fi

	echo "" >> "$RC_FILE"
	echo "# Studio CLI" >> "$RC_FILE"
	echo "$PATH_LINE" >> "$RC_FILE"

	echo "Added $BIN_DIR to PATH in $RC_FILE"
	echo "Run 'source $RC_FILE' or restart your terminal to use studio"
}

# --- Main ---

main() {
	echo "Studio CLI Installer"
	echo ""

	detect_platform
	install_studio
	ensure_path

	echo ""
	echo "Studio CLI installed successfully!"
	echo ""
	echo "  Run 'studio --help' to get started"
	echo ""
}

main
