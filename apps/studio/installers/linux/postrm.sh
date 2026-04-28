#!/bin/sh
# Studio DEB postrm — runs on remove and purge.
#
# On `purge`, remove the Studio root CA from the system trust store and refresh
# the trust bundle so that previously-issued site certificates are no longer
# trusted system-wide.

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
	remove|upgrade|failed-upgrade|abort-install|abort-upgrade|disappear)
		# Leave the trusted CA in place — re-installing or upgrading should not
		# require the user to re-trust the certificate.
		;;
esac

exit 0
