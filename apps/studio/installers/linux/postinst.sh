#!/bin/sh
# WordPress Studio — DEB postinst hook.
#
# Grants the bundled CLI binary CAP_NET_BIND_SERVICE so the proxy daemon
# can listen on privileged ports 80/443 without running as root. Without
# this, custom-domain HTTP/HTTPS sites can't bind on Linux.
#
# Filesystem capabilities are stripped on package upgrade, so dpkg invokes
# this script on every install/upgrade — no need to handle the "$1" arg.
set -e

# `electron-installer-debian` has used both /opt/<ProductName>/ (older) and
# /usr/lib/<package-name>/ (newer) as the install prefix. Probe both so
# the postinst works regardless of which layout the build produced.
CLI_BIN=""
for candidate in \
	/usr/lib/studio/resources/bin/studio \
	/opt/Studio/resources/bin/studio \
	/opt/studio/resources/bin/studio
do
	if [ -x "$candidate" ]; then
		CLI_BIN="$candidate"
		break
	fi
done

if [ -z "$CLI_BIN" ]; then
	echo "WordPress Studio: bundled CLI binary not found in any known location; skipping setcap." >&2
	echo "                  Custom-domain sites on ports 80/443 will fail to bind." >&2
	exit 0
fi

if ! command -v setcap >/dev/null 2>&1; then
	echo "WordPress Studio: 'setcap' not available; custom-domain sites on ports 80/443 will fail to bind." >&2
	echo "                  Install the 'libcap2-bin' package and run: sudo setcap 'cap_net_bind_service=+ep' $CLI_BIN" >&2
	exit 0
fi

if ! setcap 'cap_net_bind_service=+ep' "$CLI_BIN" 2>/dev/null; then
	echo "WordPress Studio: failed to set cap_net_bind_service on $CLI_BIN; custom-domain sites on ports 80/443 will fail to bind." >&2
	echo "                  Try manually: sudo setcap 'cap_net_bind_service=+ep' $CLI_BIN" >&2
fi

exit 0
