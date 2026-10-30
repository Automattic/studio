# Account funnel release handoff

Related issue: [#5594](https://github.com/Automattic/studio/issues/5594).
See the [audit](analytics-tracks-audit.md) and [event catalog](analytics-tracks.md).

## Registration packet

Register the following contracts with the Studio event owner. The existing `studio_wpcom_auth`
catalog entry names YOLO as owner; verify ownership before submitting registration. Registration
documents events and adds integrity checks; validly named events can be collected and queried before
registration. Production receipt is a separate verification step.

Every row also carries `channel`, `is_a11n`, `platform`, `arch`, `app_version`, and, for UI channels,
`ui_version`. All context fields below are optional when the initiation context cannot be recovered.
Do not remove existing properties when extending a registered event.

| Event                                                                | Contract to register or extend                                                                                                           |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `studio_account_prompt_viewed`                                       | Visible account prompt; `source`, `placement`, `intent`, `journey_id`.                                                                   |
| `studio_onboarding_viewed`                                           | Visible welcome step; `step` (`welcome`/`account`), `journey_id`.                                                                        |
| `studio_wpcom_auth_started`                                          | Explicit auth action; `source`, `auth_flow`, `auth_attempt_id`, `placement`, `intent`, `journey_id`, and `account_type` outside the CLI. |
| `studio_wpcom_auth_cancelled`                                        | Observed cancellation; the same matched initiation properties. Silence is not cancellation.                                              |
| `studio_wpcom_auth_launch_failed`                                    | Failed browser handoff; the same matched initiation properties. CLI may still complete using its printed URL.                            |
| `studio_account_journey_completed`                                   | Confirmed UI task result; `placement`, `intent`, `journey_id`. Separate conversion marker; not an operation counter.                     |
| Existing `studio_wpcom_auth`                                         | Add `auth_flow`, `auth_attempt_id`, `placement`, `intent`, `journey_id`; retain `source`, `account_type`, `success`, `failure_reason`.   |
| Existing `studio_onboarding_complete`                                | Add `completion_path` and `journey_id`; retain `authenticated`.                                                                          |
| Existing `studio_code_message_sent` and `studio_code_turn_completed` | Add `turn_id`, the opaque UUID shared by a dispatched turn and its completion; retain every existing AI property.                        |

Values and property meanings are in the event catalog and shared `auth-tracks` schemas. IDs are random,
not account identifiers. `account_type=new` means signup intent, not confirmed account creation.
Anonymous install identity and telemetry opt-out remain unchanged.

## Verified external access

Checked October 29, 2026, America/New_York:

- The Tracks provider reports `studio_wpcom_auth` as registered, with its existing properties.
- The same live catalog includes existing unregistered events: `studio_code_design_option_picked`,
  `studio_code_design_option_proposed`, `studio_preview_site_delete_all`,
  `studio_setting_ai_provider_change`, and `studio_site_open_design_system`. Include these in a
  registration housekeeping pass; their presence demonstrates that registration does not gate receipt.
- `studio_wpcom_auth_started` and `studio_account_prompt_viewed` return `found=false`; their new
  metadata/receipt has not been established.
- The connected Tracks provider exposes read-only catalog/details/activity operations.
- The registration web UI at `https://mc.a8c.com/tracks/events` could not be opened because it returned
  an authentication error. No registration was submitted and no access settings were changed.

## Release and live verification

1. Review the draft PoC, resolve required CI, and register the new contracts through an authenticated
   Tracks registration session. Do not mark local logs as production verification.
2. Use a released/canary build with telemetry enabled on a disposable test profile. Check actual
   WordPress.com login and signup returns in Desktop and browser, including denial, retry, two tabs,
   and restart. Confirm that OAuth `state` returns unchanged; keep unrecoverable context unknown.
3. In Tracks Live View and `tracks.prod_events`, inspect the test events' IDs, enum values, version and
   channel. Check the rejects view if a valid event is absent. Confirm opt-out suppresses the new events.
4. Complete share, publish, connect-and-pull, and an AI/annotation turn after authenticating. Confirm
   one conversion marker with the original journey, on the intended site. Account switches must
   invalidate waiting attribution. This does not require making a paid purchase.
5. Save the query below as a Superset dataset/query for the release. Let cohorts mature before reading
   rates. Display the eligible denominator and observation window on each chart.

## First dashboard definition

Use [the aggregate-only Trino query](analytics-tracks-account-funnel.sql). It was prepared using the
`tracks.prod_events` schema returned by the Data Science Skills query generator, but has not been
executed against the warehouse. Replace the release-version placeholder before running it.

The result is long-format data for seven charts: prompt journeys starting auth, attempt success,
returned failure, observed cancellation, no observed terminal outcome, handoff failure, and successful
auth journeys completing their task. Show volume and rate; keep channel, version, placement, intent,
and auth-flow filters visible. Handoff failure is a diagnostic and can overlap later success.

The query uses the anonymous installation identity, exact attempt-ID joins for auth, and journey-ID
plus intent joins for tasks. It deduplicates starts and requires a full 24h window for the relevant
denominator. No raw identifiers are returned. Generic same-user ordered funnels cannot substitute
for these joins when attempts overlap. Do not sum rates or compare event counts with install counts.

There is no saved live dashboard yet. A missing release/cohort is “awaiting data,” not zero conversion.
The same installation may reappear across devices/config resets as a different ID. Reload loses UI
journey context, callback attribution expires after 15 minutes, and UI journey context expires 24h
after initiation. These are observed conversions, not a complete census or a satisfaction measure.
