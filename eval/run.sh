#!/bin/bash
# Eval wrapper — ensures CLI is built before running promptfoo.
# The eval runner reads Studio auth internally via startAiAgent().
#
# Usage: ./eval/run.sh [promptfoo args...]
# Or:    npm run eval
# Or:    npm run eval -- -n 1     (run only first test)

set -euo pipefail
cd "$(dirname "$0")/.."

echo "Building CLI..."
npm run cli:build --silent

exec npx promptfoo eval -c eval/promptfoo.config.yaml "$@"
