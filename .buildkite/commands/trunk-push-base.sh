#!/usr/bin/env bash

set -euo pipefail

# Print the base of an eligible GitHub squash push. A missing or uncertain range runs all jobs.
head=$(git rev-parse HEAD)
parents=$(git log -1 --format=%P "$head")
squash_subject='\(#[0-9]+\)$'
[[ -n "$parents" && "$parents" != *' '* && "$(git log -1 --format=%s "$head")" =~ $squash_subject ]] || exit 1

before=$(buildkite-agent meta-data get buildkite:webhook | jq -er --arg head "$head" '
  select(.ref == "refs/heads/trunk" and .after == $head and .forced == false)
  | .before | select(type == "string" and test("^[0-9a-f]{40}$"))
')
[[ "$before" != "$head" ]] || exit 1
git merge-base --is-ancestor "$before" "$head"

# The previous push never got a build if its tip used a Buildkite skip marker.
previous_message=$(git log -1 --format=%B "$before")
shopt -s nocasematch
skip_marker='\[(ci[ -]skip|skip[ -]ci)\]'
[[ ! "$previous_message" =~ $skip_marker ]] || exit 1
echo "$before"
