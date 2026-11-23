#!/usr/bin/env bash

# Experiment: runs each unit test project with Vitest and with `bun test` on a
# pinned Bun canary, on the same files, and reports both in an annotation.
# The step is soft-fail: it measures, it never gates.

set -uo pipefail

BUN_VERSION=1.4.5-canary.20261123.1

# Locally: BUN=<path to bun> PROJECTS="name:dir ..." bash .buildkite/commands/try-bun-test.sh
if [ -z "${BUN:-}" ]; then
  echo '--- :package: Install deps'
  bash .buildkite/commands/install-node-dependencies.sh || exit 1

  echo "--- :bun: Install Bun $BUN_VERSION"
  npm install --no-save --no-audit --no-fund --prefix "$HOME/bun-canary" "bun@$BUN_VERSION" || exit 1
  BUN="$HOME/bun-canary/node_modules/.bin/bun"
fi
"$BUN" --revision

PROJECTS=${PROJECTS:-"blueprints:packages/blueprints common:packages/common providers:packages/providers
design-md:packages/design-md agent:packages/agent local:apps/local cli:apps/cli studio:apps/studio
mcp-ui:apps/mcp-ui ui:apps/ui scripts:scripts capture-harness:tools/capture-harness
eslint-plugin-studio:tools/eslint-plugin-studio"}

rows="| Project | Files | Vitest pass / fail | Vitest time | Bun pass / fail | Bun time |\n|---|---|---|---|---|---|\n"
results=$(mktemp -d)

for entry in $PROJECTS; do
  name=${entry%%:*}
  dir=${entry#*:}

  # The same files both runners get: Vitest's own list, without e2e-tagged tests.
  npx vitest list --filesOnly --project "$name" --tagsFilter='!e2e' 2> /dev/null |
    sed -E "s/^\[[^]]*\] //" | sed "s#^$dir/#./#" | sort -u > "$results/$name.files"
  count=$(wc -l < "$results/$name.files" | tr -d ' ')

  echo "--- :vitest: Vitest: $name ($count files)"
  start=$SECONDS
  npx vitest run --project "$name" --tagsFilter='!e2e' --reporter=default --reporter=json \
    --outputFile.json="$results/$name.vitest.json" > "$results/$name.vitest.log" 2>&1
  vitest_time=$((SECONDS - start))
  tail -5 "$results/$name.vitest.log"
  vitest_counts=$(node -e '
    try { const r = require(process.argv[1]); console.log(`${ r.numPassedTests } / ${ r.numFailedTests }`); }
    catch { console.log("no result"); }' "$results/$name.vitest.json")

  echo "--- :bun: bun test: $name ($count files)"
  start=$SECONDS
  # shellcheck disable=SC2046 # one path per line, no spaces
  (cd "$dir" && timeout 900 "$BUN" test --timeout 20000 \
    --reporter=junit --reporter-outfile="$results/$name.bun.xml" \
    $(cat "$results/$name.files")) > "$results/$name.bun.log" 2>&1
  bun_exit=$?
  bun_time=$((SECONDS - start))
  tail -8 "$results/$name.bun.log"
  bun_counts=$(node -e '
    const fs = require("fs");
    try {
      const xml = fs.readFileSync(process.argv[1], "utf8");
      const root = xml.match(/<testsuites[^>]*>/)[0];
      const n = (k) => Number((root.match(new RegExp(`${ k }="(\\d+)"`)) || [])[1] || 0);
      console.log(`${ n("tests") - n("failures") - n("skipped") } / ${ n("failures") }`);
    } catch { console.log("no result"); }' "$results/$name.bun.xml")
  [ "$bun_exit" -eq 124 ] && bun_counts="$bun_counts (timed out)"

  rows+="| $name | $count | $vitest_counts | ${vitest_time}s | $bun_counts | ${bun_time}s |\n"
done

printf "### bun test %s vs Vitest\n\n%b" "$("$BUN" --revision)" "$rows" |
  buildkite-agent annotate --style info --context bun-test-experiment
printf "%b" "$rows"
