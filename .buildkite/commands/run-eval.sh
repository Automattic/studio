#!/usr/bin/env bash
set -euo pipefail

RESULTS_FILE="eval/results.json"

echo '--- :npm: Install Node dependencies'
bash .buildkite/commands/install-node-dependencies.sh

echo '--- :hammer: Build CLI'
npm run cli:build

echo '--- :test_tube: Run agent evaluation'
eval_args=( --no-cache --output "$RESULTS_FILE" )
if [[ -n "${EVAL_TEST_FILTER:-}" ]]; then
  if ! [[ "$EVAL_TEST_FILTER" =~ ^[0-9]+$ ]]; then
    echo "Error: EVAL_TEST_FILTER must be a number, got: $EVAL_TEST_FILTER"
    exit 1
  fi
  eval_args+=( -n "$EVAL_TEST_FILTER" )
fi
npx promptfoo@0.121.4 eval -c eval/promptfoo.config.yaml "${eval_args[@]}"

echo '--- :slack: Send Slack notification'
if [[ -z "${EVAL_SLACK_CHANNEL:-}" || -z "${SLACK_TOKEN:-}" || ! -f "$RESULTS_FILE" ]]; then
  echo "Skipping Slack notification (missing channel/token/results)"
  exit 0
fi

RUN_URL="${BUILDKITE_BUILD_URL:-https://buildkite.com}"

# Slack-standard good (#36a64f) and danger (#e01e5a) attachment colors.
payload=$(jq --arg url "$RUN_URL" '
  .results.stats as $s |
  [.results.results[] |
    "• " + (.testCase.description // .vars.caseId // "unknown") + ": " +
    (if .success then "✅" else "❌" end)
  ] | join("\n") as $lines |
  (($s.successes + $s.failures + $s.errors) | tostring) as $total |
  (if $s.failures == 0 and $s.errors == 0
    then ":white_check_mark: Agent eval: " + ($s.successes | tostring) + "/" + $total + " passed"
    else ":x: Agent eval: " + ($s.failures | tostring) + "/" + $total + " failed"
  end) as $header |
  (if $s.failures == 0 and $s.errors == 0 then "#36a64f" else "#e01e5a" end) as $color |
  {
    channel: $ENV.EVAL_SLACK_CHANNEL,
    username: "Studio Eval",
    icon_emoji: ":test_tube:",
    attachments: [{
      color: $color,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: $header } },
        { type: "section", text: { type: "mrkdwn", text: $lines } },
        { type: "context", elements: [{ type: "mrkdwn", text: ("<" + $url + "|View build>") }] }
      ]
    }]
  }
' "$RESULTS_FILE")

if curl -sf -o /dev/null -X POST https://slack.com/api/chat.postMessage \
    -H "Authorization: Bearer $SLACK_TOKEN" \
    -H 'Content-Type: application/json; charset=utf-8' \
    --data-binary "$payload"; then
  echo "Sent to $EVAL_SLACK_CHANNEL"
else
  echo "Warning: Slack notification failed"
fi
