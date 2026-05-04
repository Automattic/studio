#!/bin/sh
# Cleanup hook for files that postinst placed outside the package's tracked
# paths (system trust store, AppStream metainfo). dpkg removes everything
# under /usr/lib/studio/ on its own.

set -e

# Remove the AppStream metainfo postinst placed at /usr/share/metainfo/.
# Skipped on `upgrade` — the new package's postinst overwrites it.
case "$1" in
	remove|purge)
		rm -f /usr/share/metainfo/com.automattic.Studio.metainfo.xml
		;;
esac

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
