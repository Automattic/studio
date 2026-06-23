#!/bin/sh
set -eu

# Studio CLI installer
# Usage: curl -fsSL https://wp.build/install.sh | bash
#
# Environment variables:
#   STUDIO_CLI_HOME     — Installation directory (default: ~/.studio)
#   STUDIO_CLI_VERSION  — Version to install from the CDN (default: latest, e.g. v1.11.0)
#   STUDIO_CLI_URL      — Override the download source with a base URL or local dir,
#                         bypassing the CDN. Expects studio-cli-<platform>-<arch>.tgz
#                         (used for testing and mirrors).

INSTALL_DIR="${STUDIO_CLI_HOME:-$HOME/.studio}"
BIN_DIR="$HOME/.local/bin"
CDN_BASE="https://appscdn.wordpress.com/downloads/wordpress-com-studio-cli"
CDN_VERSION="${STUDIO_CLI_VERSION:-latest}"

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

	# Apps CDN platform slug used to build the default download path.
	case "$PLATFORM-$ARCH" in
		darwin-arm64) SLUG="mac-silicon" ;;
		darwin-x64)   SLUG="mac-intel" ;;
		linux-x64)    SLUG="linux-x64" ;;
		linux-arm64)  SLUG="linux-arm64" ;;
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
	BUNDLE_NAME="studio-cli-${PLATFORM}-${ARCH}.tgz"

	# Default to the Apps CDN, which 302-redirects "latest" (or a pinned version) to
	# the newest published bundle. STUDIO_CLI_URL overrides this with a base URL or
	# local dir that serves the bundle by name — used for local testing, mirrors, or
	# pinning an arbitrary build.
	if [ -n "${STUDIO_CLI_URL:-}" ]; then
		BUNDLE_URL="${STUDIO_CLI_URL}/${BUNDLE_NAME}"
	else
		BUNDLE_URL="${CDN_BASE}/${SLUG}/${CDN_VERSION}/full-install"
	fi

	mkdir -p "$INSTALL_DIR"

	# Download and extract in a staging dir on the same filesystem as the final
	# paths. A failed, corrupt, or truncated download fails at extraction below and
	# never touches a previously working install.
	STAGING_DIR="$(mktemp -d "${INSTALL_DIR}/.studio-install.XXXXXX")"
	trap 'rm -rf "$STAGING_DIR"' EXIT

	TMP_BUNDLE="$STAGING_DIR/$BUNDLE_NAME"

	echo "Downloading Studio CLI..."
	download "$BUNDLE_URL" "$TMP_BUNDLE"

	echo "Installing to $INSTALL_DIR..."
	mkdir -p "$STAGING_DIR/extracted"
	if ! tar -xzf "$TMP_BUNDLE" -C "$STAGING_DIR/extracted"; then
		echo "Error: failed to extract bundle (corrupt or incomplete download). Aborting; existing install left untouched." >&2
		exit 1
	fi

	# macOS tags browser-downloaded archives with com.apple.quarantine, and tar
	# propagates it to the extracted files — which makes Gatekeeper refuse to load
	# the unsigned native .node modules ("library load disallowed by system policy").
	# A curl/wget install isn't quarantined, but clear it defensively so installs from
	# a manually-downloaded bundle (or on quarantine-strict/MDM Macs) still work.
	if [ "$(uname)" = "Darwin" ]; then
		xattr -dr com.apple.quarantine "$STAGING_DIR/extracted" 2>/dev/null || true
	fi

	# A previous standalone install may have a running daemon and site servers
	# holding open handles on bin/node and cli/. Stop them first so replacing the
	# runtime doesn't orphan those processes. Best-effort: never abort a reinstall.
	if [ -x "$INSTALL_DIR/bin/studio" ]; then
		echo "Stopping running Studio sites and daemon..."
		"$INSTALL_DIR/bin/studio" site stop --all || true
	fi

	# Replace only the runtime dirs. Config files in $INSTALL_DIR (shared.json,
	# cli.json, app.json, …) are left untouched.
	rm -rf "$INSTALL_DIR/cli" "$INSTALL_DIR/bin"
	mv "$STAGING_DIR/extracted/cli" "$INSTALL_DIR/cli"
	mv "$STAGING_DIR/extracted/bin" "$INSTALL_DIR/bin"

	chmod +x "$INSTALL_DIR/bin/node" "$INSTALL_DIR/bin/studio"

	# Symlink to PATH
	mkdir -p "$BIN_DIR"
	ln -sf "$INSTALL_DIR/bin/studio" "$BIN_DIR/studio"
}

# --- PATH setup ---

ensure_path() {
	case ":${PATH}:" in
		*":${BIN_DIR}:"*) return ;;
	esac

	SHELL_NAME="$(basename "${SHELL:-sh}")"
	case "$SHELL_NAME" in
		zsh)  RC_FILE="$HOME/.zshrc" ;;
		bash) RC_FILE="$HOME/.bashrc" ;;
		fish) RC_FILE="$HOME/.config/fish/config.fish" ;;
		*)    RC_FILE="$HOME/.profile" ;;
	esac

	# Write the literal "$HOME/.local/bin" (not the install-time expanded path) so
	# the line matches what the desktop app writes and looks for — a single shared
	# PATH entry instead of two divergent ones.
	if [ "$SHELL_NAME" = "fish" ]; then
		PATH_LINE='set -gx PATH "$HOME/.local/bin" $PATH'
	else
		PATH_LINE='export PATH="$HOME/.local/bin:$PATH"'
	fi

	# Exact-line match — a substring hit against an unrelated ".local/bin/..."
	# entry shouldn't make us skip adding our own line.
	if [ -f "$RC_FILE" ] && grep -qxF "$PATH_LINE" "$RC_FILE" 2>/dev/null; then
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
