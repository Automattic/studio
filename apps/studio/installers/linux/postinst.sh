#!/bin/sh
# WordPress Studio — DEB postinst hook.
#
# Grants the bundled Node binary CAP_NET_BIND_SERVICE so the proxy daemon
# can listen on privileged ports 80/443 without running as root. Without
# this, custom-domain HTTP/HTTPS sites can't bind on Linux.
#
# Filesystem capabilities are stripped on package upgrade, so dpkg invokes
# this script on every install/upgrade — no need to handle the "$1" arg.
set -e

# `electron-installer-debian` has used both /opt/<ProductName>/ (older) and
# /usr/lib/<package-name>/ (newer) as the install prefix. Probe both so
# the postinst works regardless of which layout the build produced.
NODE_BIN=""
for candidate in \
	/usr/lib/studio/resources/bin/node \
	/opt/Studio/resources/bin/node \
	/opt/studio/resources/bin/node
do
	if [ -x "$candidate" ]; then
		NODE_BIN="$candidate"
		break
	fi
done

if [ -z "$NODE_BIN" ]; then
	echo "WordPress Studio: bundled node not found in any known location; skipping setcap." >&2
	echo "                  Custom-domain sites on ports 80/443 will fail to bind." >&2
	exit 0
fi

if ! command -v setcap >/dev/null 2>&1; then
	echo "WordPress Studio: 'setcap' not available; custom-domain sites on ports 80/443 will fail to bind." >&2
	echo "                  Install the 'libcap2-bin' package and run: sudo setcap 'cap_net_bind_service=+ep' $NODE_BIN" >&2
	exit 0
fi

if ! setcap 'cap_net_bind_service=+ep' "$NODE_BIN" 2>/dev/null; then
	echo "WordPress Studio: failed to set cap_net_bind_service on $NODE_BIN; custom-domain sites on ports 80/443 will fail to bind." >&2
	echo "                  Try manually: sudo setcap 'cap_net_bind_service=+ep' $NODE_BIN" >&2
fi

exit 0
