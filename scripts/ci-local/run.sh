#!/bin/bash
# Runs the Buildkite CI jobs on this machine, so a branch can be checked before it merges,
# including the jobs that only run on trunk (Performance Metrics). See scripts/ci-local/README.md.
#
#   npm run ci:local                    pipeline, lint, unit tests (a few minutes)
#   npm run ci:local -- --full          adds CLI E2E, E2E and the metrics tests (packages the app)
#   npm run ci:local -- --linux         adds the Linux jobs, run in CI's Docker image
#   npm run ci:local -- lint unit       only the stages named
set -uo pipefail

cd "$( git rev-parse --show-toplevel )" || exit 1
ROOT=$PWD
STUBS="$ROOT/scripts/ci-local/bin"
export PATH="$PATH:$STUBS"
export BUILDKITE_PIPELINE_SLUG=studio

stages=( pipeline lint unit )
named=()
for arg in "$@"; do
	case "$arg" in
		--full) stages+=( cli-e2e e2e metrics ) ;;
		--linux) stages+=( linux ) ;;
		-h | --help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		-*) echo "Unknown option: $arg" >&2; exit 2 ;;
		*) named+=( "$arg" ) ;;
	esac
done
[ ${#named[@]} -gt 0 ] && stages=( "${named[@]}" )

# The CLI and app read and write a config folder; never touch the real ~/.studio.
DEV_CONFIG_DIR=$( mktemp -d "${TMPDIR:-/tmp}/studio-ci-local.XXXXXX" )
export DEV_CONFIG_DIR

stage_pipeline() {
	echo "Checking the CI scripts and pipeline file"
	local f ok=0
	for f in .buildkite/commands/*.sh .buildkite/shared-pipeline-vars; do
		bash -n "$f" || { echo "✖ $f has a syntax error"; ok=1; }
	done
	# What a pull request with these changes would run: CI sources this file before uploading the pipeline.
	local vars
	vars=$( BUILDKITE_PULL_REQUEST=1 bash -c 'set -e; source .buildkite/shared-pipeline-vars >/dev/null; env' ) || {
		echo "✖ .buildkite/shared-pipeline-vars failed"
		return 1
	}
	echo "On a pull request with these changes, CI would:"
	local name value
	for name in VALIDATION E2E METRICS FASTLANE; do
		value=$( printf '%s\n' "$vars" | sed -n "s/^SKIP_$name=//p" )
		if [ "$value" = false ] || [ -z "$value" ]; then
			echo "  run    $name"
		else
			echo "  skip   $name ($value)"
		fi
	done
	printf '%s\n' "$vars" > "$DEV_CONFIG_DIR/pipeline-vars"
	node scripts/ci-local/pipeline.mjs check "$DEV_CONFIG_DIR/pipeline-vars" || ok=1
	return $ok
}

stage_lint() {
	npm run lint && npm run knip && npm run typecheck
}

stage_unit() {
	npm run test -- --tagsFilter='!e2e'
}

stage_cli_e2e() {
	npm run cli:build &&
		node apps/cli/dist/cli/main.mjs site list &&
		npm test -- --project cli --tagsFilter='e2e' --no-file-parallelism .e2e.test.ts
}

package_app() {
	[ -n "${PACKAGED:-}" ] && return 0
	local arch
	arch=$( uname -m )
	[ "$arch" = x86_64 ] && arch=x64
	IS_DEV_BUILD=true npm -w studio-app run package -- --arch="$arch" --platform=darwin && PACKAGED=1
}

stage_e2e() {
	npm run e2e:fixtures -- --require && package_app && npx playwright test
}

stage_metrics() {
	package_app &&
		ARTIFACTS_PATH="$DEV_CONFIG_DIR/metrics" npm run test:metrics &&
		npm -w compare-perf run compare -- --help > /dev/null
}

stage_linux() {
	if ! docker info > /dev/null 2>&1; then
		echo "✖ Docker isn't running. Start it (for example \`colima start --cpu 4 --memory 8\`) and run again."
		return 1
	fi
	node scripts/ci-local/pipeline.mjs linux "$DEV_CONFIG_DIR/pipeline-vars" "$STUBS" "${LINUX_STEPS:-}"
}

results=()
failed=0
for stage in "${stages[@]}"; do
	fn="stage_${stage//-/_}"
	if ! declare -f "$fn" > /dev/null; then
		echo "Unknown stage: $stage (pipeline, lint, unit, cli-e2e, e2e, metrics, linux)" >&2
		exit 2
	fi
	# The linux stage reads the pipeline variables the pipeline stage writes.
	if [ "$stage" = linux ] && [ ! -f "$DEV_CONFIG_DIR/pipeline-vars" ]; then
		stage_pipeline > /dev/null 2>&1
	fi
	echo
	echo "━━━ $stage"
	start=$SECONDS
	if "$fn"; then
		results+=( "✔ $stage ($(( SECONDS - start )) s)" )
	else
		results+=( "✖ $stage ($(( SECONDS - start )) s)" )
		failed=1
	fi
done

rm -rf "$DEV_CONFIG_DIR"
echo
printf '%s\n' "${results[@]}"
exit $failed
