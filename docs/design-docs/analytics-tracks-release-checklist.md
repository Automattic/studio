# Account event validation

The account events use the existing Tracks sender, anonymous installation identity, opt-out checks,
and development/build gates. Operation events retain their existing owners; the journey marker
measures attribution and must not be added to operation counts.

- Prompt exposure records visible account UI. Signup/login describes the chosen route, not confirmed
  account creation or the sign-in provider used on WordPress.com.
- Auth outcomes match an opaque attempt ID. Callback context expires after 15 minutes; missing or
  expired context stays unknown. Browser handoff failure can coexist with later CLI success.
- Task attribution is in memory, scoped to the initiating site when available, and expires 24 hours
  after initiation. Account changes invalidate it. Reload/restart does not reconstruct attribution.
- Journey results carry a bounded `completion_kind`. `ai_response` is a successful AI response;
  `ai_edit` additionally requires a successful Write/Edit call in that exact turn. Missing edit stats
  never establish an edit. Neither proves a completed or correct site build. Other kinds distinguish
  preview create/update, sync push, and the pull in connect-and-pull.
- AI journey markers share an opaque `turn_id` with the dispatched turn and its CLI-owned completion
  event. Session IDs or a later turn cannot substitute for an exact match.
- Attempt/journey/turn IDs add behavioral linkability within the existing installation identity.
  New properties include no account/site identifiers, content, credentials, or raw error text.

Before merging, run relevant tests, modified-file lint, full typecheck, and required CI. Verify actual
WordPress.com login/signup state echo, denial, retries and parallel tabs in Desktop and browser;
mocked callbacks are not provider verification. Verify packaged-app behavior separately.

Register the event/property contracts and confirm receipt and opt-out in an eligible canary/release.
Local logs and registration are not warehouse verification. Unmatched, expired or reloaded context
is coverage loss; an unobserved outcome is not proof of cancellation, failure or abandonment.

The optional numeric `journey_started_at` is captured at authentication initiation and accompanies
that attempt and its task marker. It is the same millisecond clock used for the 24h expiry check;
a retry refreshes it. Correlation requires matching journey, placement, intent and initiation timestamp,
with task completion after successful auth and no later than initiation plus 24h. This adds timing
metadata, not a new identifier, destination or identity mechanism.
