#!/usr/bin/env bash

set -euo pipefail

if .buildkite/commands/should-skip-job.sh --job-type validation; then
  exit 0
fi

echo '--- :package: Install deps'
bash .buildkite/commands/install-node-dependencies.sh

echo '--- :react: React Doctor'

SCORE_THRESHOLD=95
DOCTOR_EXIT=0

# Run react-doctor and capture output
# Don't use --offline so score gets calculated
# Use --fail-on error to catch error-level issues
OUTPUT=$(npx -y react-doctor --no-ami --yes --fail-on error 2>&1) || DOCTOR_EXIT=$?

echo "$OUTPUT"

# Strip ANSI escape codes for score parsing and annotation
CLEAN_OUTPUT=$(echo "$OUTPUT" | sed $'s/\x1b\\[[0-9;]*m//g')

# Parse score from clean output (format: "XX / 100")
SCORE=$(echo "$CLEAN_OUTPUT" | grep -oE '[0-9]+ / 100' | head -1 | grep -oE '^[0-9]+') || true

# Post annotation to Buildkite UI
if command -v buildkite-agent &> /dev/null; then

  if [ -n "$SCORE" ]; then
    if [ "$SCORE" -lt "$SCORE_THRESHOLD" ]; then
      STYLE="error"
      HEADER="React Doctor Score: ${SCORE}/100 (below threshold of ${SCORE_THRESHOLD})"
    else
      STYLE="success"
      HEADER="React Doctor Score: ${SCORE}/100"
    fi
  else
    STYLE="warning"
    HEADER="React Doctor (score not available)"
  fi

  cat <<EOF | buildkite-agent annotate --style "$STYLE" --context "react-doctor"
### :react: ${HEADER}

<details>
<summary>Full diagnostics</summary>

\`\`\`
${CLEAN_OUTPUT}
\`\`\`

</details>
EOF
fi

# Fail if react-doctor itself failed (--fail-on error)
if [ "$DOCTOR_EXIT" -ne 0 ]; then
  echo "^^^ +++"
  echo "React Doctor found error-level issues (exit code: ${DOCTOR_EXIT})"
  exit 1
fi

# Fail if score is below threshold
if [ -n "$SCORE" ] && [ "$SCORE" -lt "$SCORE_THRESHOLD" ]; then
  echo "^^^ +++"
  echo "React Doctor score ${SCORE}/100 is below the threshold of ${SCORE_THRESHOLD}/100"
  exit 1
fi

echo "React Doctor score: ${SCORE:-unknown}/100 (threshold: ${SCORE_THRESHOLD}/100)"
