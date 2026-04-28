#!/bin/sh
# On `purge`, remove the Studio root CA from the system trust store.

set -e

case "$1" in
	purge)
		STUDIO_CA_PATH="/usr/local/share/ca-certificates/studio-ca.crt"
		if [ -f "$STUDIO_CA_PATH" ]; then
			rm -f "$STUDIO_CA_PATH"
			if command -v update-ca-certificates >/dev/null 2>&1; then
				update-ca-certificates --fresh >/dev/null || true
			fi
		fi
		;;
esac

exit 0
