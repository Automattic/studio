#!/usr/bin/env bash
# Runs `studio ui` in the background on port 8081. Its output goes to /tmp/studio-ui.log.
set -euo pipefail

args=( ui --no-open --port 8081 )
# In a Codespace the browser reaches the UI through the forwarded port's URL.
if [ -n "${CODESPACE_NAME:-}" ]; then
	args+=( --allowed-origin "https://${CODESPACE_NAME}-8081.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}" )
fi

nohup node apps/cli/dist/cli/main.mjs "${args[@]}" > /tmp/studio-ui.log 2>&1 &
