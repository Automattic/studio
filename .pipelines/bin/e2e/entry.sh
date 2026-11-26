#!/usr/bin/env bash
# The Studio Electron e2e runner inside its image (see Dockerfile), as `.pipelines/bin/env.mjs test
# e2e` starts it. /src is the worktree, read-only; /work is the worktree's copy, with its Linux
# dependencies and packaged app; /results is the worktree's `test-results` folder.
#
#   entry.sh run [<playwright args>]   Bring /work up to date, then run the specs.
#   entry.sh prepare                   Bring /work up to date: sync, then install, download the
#                                      fixtures, and package the app when what changed needs it.
#   entry.sh shell                     A shell, for debugging.
set -euo pipefail

ARCH="${E2E_ARCH:-$(node -p process.arch)}"
APP_DIR="/work/apps/studio/out/Studio-linux-${ARCH}"
STATE=/work/.rp-e2e
# The files the syncs changed since the app was last packaged.
PENDING="$STATE/pending"

# step <name> <command...>: runs a command with its output in $STATE/<name>.log, and says how it went.
step() {
	local name=$1 start rc=0
	shift
	start=$(date +%s)
	"$@" > "$STATE/$name.log" 2>&1 || rc=$?
	if [ $rc -eq 0 ]; then
		echo "[e2e] $name: done in $(( $(date +%s) - start )) s"
	else
		echo "[e2e] $name: failed (exit $rc) after $(( $(date +%s) - start )) s. The end of its log:"
		tail -n 60 "$STATE/$name.log"
	fi
	return $rc
}

# Copies the results and the setup logs to the worktree, whatever happened.
publish() {
	[ -d /results ] || return 0
	find /results -mindepth 1 -delete 2>/dev/null || true
	[ -d /work/test-results ] && cp -a /work/test-results/. /results/ || true
	mkdir -p /results/setup-logs
	cp "$STATE"/*.log /results/setup-logs/ 2>/dev/null || true
}

sync_work() {
	mkdir -p "$STATE"
	touch "$PENDING"
	rsync -a --delete --itemize-changes --out-format='%i %n' --filter="merge /opt/e2e/sync-filter" /src/ /work/ > "$STATE/sync.out"
	# Files and links rsync created, updated (`>f`, `cf`, `cL`) or deleted.
	awk '{ item = $1; name = $0; sub( /^[^ ]+ +/, "", name ) }
		item == "*deleting" { print name; next }
		item ~ /^[>c][fL]/ { print name }' "$STATE/sync.out" > "$STATE/sync.changed"
	echo "[e2e] sync: $(wc -l < "$STATE/sync.changed" | tr -d ' ') files changed"
	sort -u "$PENDING" "$STATE/sync.changed" -o "$PENDING"
}

do_install() {
	npm ci --no-audit --no-fund --no-progress
}

do_fixtures() {
	npm run e2e:fixtures -- --require
}

do_package() {
	# The language packs only download once: the package step leaves them in wp-files.
	if ls /work/wp-files/latest/languages/*.zip > /dev/null 2>&1; then
		export SKIP_LANGUAGE_PACKS=1
	fi
	npm -w studio-app run package -- --arch="$ARCH" --platform=linux
	# Same as CI: no setuid sandbox helper in a container (the e2e helpers pass --no-sandbox).
	rm -f "$APP_DIR/chrome-sandbox"
	for f in php-server-child.mjs main.mjs wp-files/reprint/reprint.phar; do
		[ -f "apps/cli/dist/cli/$f" ] || { echo "missing CLI artifact $f"; return 1; }
	done
}

prepare() {
	cd /work
	sync_work
	local installed=0
	if [ ! -f "$STATE/installed" ] || grep -Eq '(^|/)package(-lock)?\.json$' "$PENDING"; then
		rm -f "$STATE/installed" "$STATE/packaged"
		step install do_install
		touch "$STATE/installed"
		installed=1
	fi
	if [ $installed = 1 ] || [ ! -f "$STATE/fixtures" ] || grep -q '^test-fixtures/' "$PENDING"; then
		step fixtures do_fixtures
		touch "$STATE/fixtures"
	fi
	# What the specs and their fixtures change needs no new package; anything else does.
	if [ ! -x "$APP_DIR/studio" ] || [ ! -f "$STATE/packaged" ] ||
		grep -Evq '^(apps/studio/e2e/|playwright\.config\.ts$|test-fixtures/)' "$PENDING"; then
		rm -f "$STATE/packaged"
		step package do_package
		touch "$STATE/packaged"
	else
		echo "[e2e] package: current"
	fi
	: > "$PENDING"
}

run_tests() {
	trap publish EXIT
	prepare
	step browsers npx playwright install chromium
	rm -rf /work/test-results
	export STUDIO_E2E_DAEMON_LOGS_DIR=/work/test-results/daemon-logs
	xvfb-run -a -s "-screen 0 1920x1080x24" npx playwright test --retries=0 --output=/work/test-results "$@"
}

cmd=${1:-}
shift || true
case "$cmd" in
	run) run_tests "$@" ;;
	prepare) prepare ;;
	shell) exec bash "$@" ;;
	*) echo "usage: entry.sh run [<playwright args>] | prepare | shell"; exit 2 ;;
esac
