#!/usr/bin/env bash
exec node "$(dirname "$0")/../apps/cli/dist/cli/eval-runner.mjs" "$@"
