# Studio Tracks audit: questions first

Audit date: October 29, 2026 (America/New_York).

## P0 implementation follow-up

The audit below is the original code-coverage snapshot. A subsequent local P0 implementation adds
prompt/welcome visibility, auth starts and matched outcomes across Desktop/browser/CLI, explicit
observed cancellation and handoff failure, detailed placement/intent, onboarding completion paths,
and opaque journey context. P1 and P2 remain backlog items.

Task attribution uses `studio_account_journey_completed` as a separate conversion marker rather than
copying CLI-owned operation events into another host or threading analytics flags through every site
command. It captures context at the deliberate task start and emits only after the existing result
confirms success. Ordinary operation counts remain unchanged. AI start/completion events also gain
`turn_id` for exact pairing.

Journeys are scoped to an initiating site when known, expire after 24h, and are in memory. A general
Settings setup has no site and can convert on its first eligible task. Reload/restart loses task
attribution; OAuth callback context also expires after 15 minutes. These limits must be shown when
reading conversion. WordPress.com state echo, event registration, and production receipt still need
a release/canary check; this implementation does not establish new-account or purchase truth.

Initial readout after registration: distinct installations exposed; starts / exposures by placement;
successful distinct attempt IDs / mature starts; explicit cancellations; starts with no observed
callback/cancellation after 24h; and distinct completed journey IDs joined to successful auth / auth
journeys eligible for that intent. Report each channel/version separately. Treat handoff failures as
diagnostics rather than terminal outcomes: the CLI can continue using the printed URL. Do not join
unknown callbacks to the nearest start.

### P0 local verification

- 531 relevant tests passed across 54 files, covering auth/context/callbacks, browser routes,
  connector contracts, account prompts, onboarding, provider/settings routing, site delivery,
  previews, sync, Add site, and AI turns.
- Modified-file ESLint/formatting, Knip, browser UI/CLI build, documentation formatting, and local
  source-link checks passed.
- Full `npm run typecheck` ran. Local server, UI, Desktop and shared packages passed; CLI still
  reports the pre-existing archiver declarations, array target, socket Buffer, unused expectation
  directive, and optional-invocation errors.
- Playwright checked `http://localhost:8096` using a disposable configuration: 1280×800 in light and
  dark and 390×800 in dark. Welcome → account, simulated popup handoff/close, and Not now → Add site
  worked with no console warnings/errors. Development dry-run logs confirmed welcome/account
  exposure, matching auth-start/cancellation IDs, and unauthenticated onboarding completion with
  `completion_path=continue_without_account`. No production Tracks requests were sent.
- Desktop evidence is typecheck and mocked IPC/auth callback tests; no packaged-app or real OAuth
  account flow was run. New event/property registration and production ingestion remain release
  checks. The implementation remains local, alongside the existing UI work.

### Review and release follow-up

Related issue: [#5594](https://github.com/Automattic/studio/issues/5594). The focused PR snapshot is
based on trunk `c69cb6351` and excludes the unrelated local Welcome and publishing layout changes.
Its current-trunk Welcome remains one step; the broader local checkout has the separate two-step UI.
The telemetry contract supports both without making the redesign a dependency.

The isolated snapshot passed 525 tests across 53 files before supplemental Desktop-initiation and
parallel-browser-callback coverage. Its browser UI/CLI build also passed. Dependencies were reused
from the primary checkout; the temporary test runner allowed those dependency assets explicitly.
No repository test/build config changes are included in the PR.

Live Tracks metadata now confirms the existing authentication event is registered and identifies
registration housekeeping for some existing events. The new auth-start and prompt-view metadata
has not appeared. See the [registration and release packet](analytics-tracks-release-checklist.md)
for exact contracts, access limits, and the [aggregate funnel query](analytics-tracks-account-funnel.sql).
The query is prepared, not warehouse-executed; no live dashboard is claimed.

## Measurement and privacy review

Reviewed the P0 PR against the questions, not just its test results. The additions are useful for
observed account-funnel conversion; they do not answer every product question in this audit.

| Question                                         | What this PR supports                                                                                             | Remaining boundary                                                                                                                                   |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which prompts lead to authentication?            | Visible prompt journeys, explicit starts, placement and signup/login route.                                       | Rates describe anonymous installations/journeys, not unique people; hidden or suppressed events are not exposures.                                   |
| Which attempts succeed or stop?                  | Exact attempt joins for successful returns, returned failures, observed cancellation and handoff failures.        | A missing return is unobserved, not proven abandonment. No visibility into individual WordPress.com screens.                                         |
| Does authentication lead to intended work?       | Match successful auth and confirmed share, push, connect-and-pull or AI/annotation results by journey and intent. | Observational attribution, not causal lift or satisfaction; reload/restart loses in-memory context. The 24h journey limit starts at auth initiation. |
| Which sign-in provider or newly created account? | Signup versus login entry route only.                                                                             | Google/Apple/email choice and authoritative account creation need WordPress.com evidence.                                                            |
| Which models are used and finish reliably?       | Existing provider/model events, with a new per-turn ID for exact pairing.                                         | A successful turn is not proof of a useful edit or a satisfied user.                                                                                 |
| What brings people back or leads to revenue?     | Existing activity can support a separately defined retention analysis.                                            | This PR adds no authoritative transaction evidence and no validated retention readout.                                                               |

Review validation: 532 tests passed across 54 files. Modified-code lint passed; full workspace
typecheck retains the existing CLI errors. The draft SQL was inspected but not warehouse-executed.

Two review findings were corrected: captured tasks now recheck the 24h attribution expiry at completion,
and the draft query excludes installations with any observed staff flag in the candidate release/window.
Filtering staff event-by-event would retain signed-out staff starts but drop their authenticated success,
biasing conversion downward. Staff never identified in the window still cannot be excluded reliably.

The added fields are bounded route/intent/outcome values and random attempt, journey and turn IDs.
These IDs are needed for overlapping attempts and exact pairing; they increase behavioral linkability
within the existing anonymous installation identity. They are not account IDs and are not a claim of
unlinkability. No new destination or account identity is added. Tokens, emails, prompts, site content,
site identifiers and raw error text are excluded from the new analytics properties; site scope stays
in memory. Existing telemetry wrappers and opt-out controls remain the emission gate.

Keep this draft until actual OAuth state round-tripping and production receipt are verified. Check
matched and unmatched outcomes by channel/version before publishing any conversion rate. The SQL
is a reviewable draft, not an executed result or a saved dashboard.

## Findings

Studio has substantial coverage of completed work: site creation, starts, imports, exports, previews,
sync, AI turns, and some settings changes. The biggest missing pieces are the steps **before** those
outcomes: seeing an account prompt, starting authentication, leaving without returning, and resuming
the action that required an account.

Prioritize these questions:

1. Which account prompts lead people to start authentication and successfully connect?
2. Where do they stop: before clicking, during WordPress.com authentication, or after returning?
3. After connecting, do they accomplish what brought them there: build, share, publish, or connect?
4. Which first actions lead to repeat use, and how long does reaching those actions take?
5. Which provider, payment, credit, or operational barriers prevent those actions?

This is an instrumentation audit, not a usage readout. No production counts, conversion rates, event
registration, or warehouse receipt were verified. “Covered” below means the code emits the relevant
signal, subject to the qualifications listed. It does not mean production data has been validated.
See the [event catalog and transport design](analytics-tracks.md) for the full existing inventory.

## Evidence and release boundaries

Inspected the working checkout on `add-annotate-helper`, HEAD `31eb47b29`, and `origin/trunk`
`0cc5d32d33729ad242dacbb46ad4ff7efc378e97`. A live remote ref check matched that trunk SHA. The
checkout contains unrelated, uncommitted UI work, including a two-step welcome screen; trunk has a
single welcome screen. Neither layout currently records prompt exposure or authentication starts.
This report adds no runtime changes and leaves that work intact.

GitHub searches covered recent authentication/Tracks changes and relevant open feature PRs. These
are a targeted sample, not a claim that every historical or open PR was inspected. Statuses are a
snapshot; merged code is not proof of inclusion in an installed release or beta.

| Change                                                                                                                                       | Verified state                    | Implication for this audit                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#5494 — Simplify welcome and account dialogs](https://github.com/Automattic/studio/pull/5494)                                               | Merged; present in trunk          | Account prompts and shared onboarding completion already exist. They are not missing product features.                                                                 |
| [#5511 — Unify preview sharing and publishing](https://github.com/Automattic/studio/pull/5511)                                               | Merged; present in trunk          | Audit the combined Share/Publish journey, including authentication followed by delivery.                                                                               |
| [#5593 — Unify welcome and account prompt dialog spacing](https://github.com/Automattic/studio/pull/5593)                                    | Open; patch inspected             | Layout changes preserve the existing source attribution; they do not add funnel events.                                                                                |
| [#5589 — Refine the site header and preview controls](https://github.com/Automattic/studio/pull/5589)                                        | Open draft; patch inspected       | New placement does not introduce prompt/start measurement. Do not infer a new event from a new affordance.                                                             |
| [#5525 — Preview sites: create new previews on WordPress.com](https://github.com/Automattic/studio/pull/5525)                                | Open; patch inspected             | Preserves preview event call sites while changing the backend. Compare versions separately; “WordPress.com site created” must not automatically mean a paid live site. |
| [#5567 — Publish a static copy of a site to Spacefast](https://github.com/Automattic/studio/pull/5567)                                       | Open draft; patch inspected       | Adds a separate device-login and publishing journey without adding Tracks calls. Track as upcoming work, not a current trunk regression.                               |
| [#5427 — Studio Code: Serve the agent over the Agent Client Protocol with `studio code acp`](https://github.com/Automattic/studio/pull/5427) | Open draft; description inspected | Explicitly documents missing per-turn telemetry and an unresolved channel choice. This is a pending-surface concern, not current ACP production usage.                 |

### Code evidence

All paths below are relative to the repository root. Links point to the local sources used for this
audit; the SHAs above identify the baseline when those files subsequently change.

| Reference | Sources inspected                                                                                                                                                                                                                                                                                                                                                                                        | What they establish                                                                                                                                                                                            |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A         | [Event definitions](../../packages/common/lib/record-tracks-event.ts), [Desktop wrapper](../../apps/studio/src/lib/tracks.ts), [CLI wrapper](../../apps/cli/lib/tracks.ts)                                                                                                                                                                                                                               | Known event names, anonymous identity, common properties, opt-out and build gates, best-effort pixel delivery.                                                                                                 |
| B         | [Login hook](../../apps/ui/src/data/queries/use-auth-user.ts), [Desktop authenticate handler](../../apps/studio/src/ipc-handlers.ts), [pending context](../../apps/studio/src/lib/auth-tracks-context.ts), [auth callback](../../apps/studio/src/lib/deeplink/handlers/auth.ts)                                                                                                                          | Source flows to Desktop outcomes; there is no start event; pending context is in memory, expires after 15 minutes, and uses last-write-wins.                                                                   |
| C         | [Browser connector](../../apps/ui/src/data/core/connectors/local/index.ts), [local server](../../apps/local/src/index.ts), [CLI token storage](../../apps/cli/lib/wpcom-auth.ts)                                                                                                                                                                                                                         | Browser authentication drops the source argument and emits no auth outcome from its login routes. CLI token validation/storage emits outcomes with `source=cli`. Browser onboarding completion is implemented. |
| D         | [Account prompt](../../apps/ui/src/features/account/account-prompt/index.tsx), [Welcome](../../apps/ui/src/features/onboarding/welcome-dialog/index.tsx), [account menu](../../apps/ui/src/features/account/user-menu/index.tsx), [site delivery](../../apps/ui/src/features/site-delivery/site-delivery.tsx), [Add site connection](../../apps/ui/src/features/sites/add-site-dialog/connect-panel.tsx) | Current prompt paths and shared source values; no prompt exposure/click tracking in the shared account prompt.                                                                                                 |
| E         | [AI settings](../../apps/ui/src/features/settings/settings-view/ai-panel.tsx), [Sharing settings](../../apps/ui/src/features/settings/settings-view/sharing-panel.tsx), [account settings](../../apps/ui/src/features/settings/settings-view/account-section.tsx), [Usage settings](../../apps/ui/src/features/settings/settings-view/usage-panel.tsx)                                                   | Multiple settings affordances collapse into broad source buckets. Provider connection is an alternative to WordPress.com auth.                                                                                 |
| F         | [Site creation](../../apps/cli/commands/site/create.ts), [preview creation](../../apps/cli/commands/preview/create.ts), [push](../../apps/cli/commands/push.ts), [pull](../../apps/cli/commands/pull.ts), [UI sync](../../apps/ui/src/data/queries/use-sync-site.ts)                                                                                                                                     | Creation records successful provision; previews and transfers record results. Cancellation and operation suppression need distinct treatment.                                                                  |
| G         | [AI turn emitter](../../apps/cli/commands/ai/index.ts), [MCP runtime](../../apps/cli/ai/runtimes/mcp/index.ts), [model picker](../../apps/ui/src/features/composer/model-picker.tsx)                                                                                                                                                                                                                     | Model/provider usage is already recorded per dispatched turn; model-picker exposure, blocked choices, and abandoned drafts are not.                                                                            |
| H         | [Composer barriers](../../apps/ui/src/features/chats/session-view/use-composer-notice.ts), [credits handoff](../../apps/ui/src/features/credits/use-open-ai-credits-checkout.ts), [credits result](../../apps/ui/src/features/credits/use-ai-credits-purchase-result.ts)                                                                                                                                 | UI barriers and checkout handoffs exist without matching Tracks funnel events. Balance growth is a UI confirmation signal, not an authoritative receipt.                                                       |

## Questions and present coverage

**Covered:** a signal exists for the stated measure. **Partial:** useful signal, insufficient attribution
or denominator. **Missing:** no dedicated signal found. **External:** needs evidence outside Studio.
All measures describe telemetry-enabled installations, not all people who use Studio.

| ID / priority | Question and decision supported                                                                            | Population / denominator                                                        | Existing signal and status                                                                                                                                                                                       | Gap or smallest remedy                                                                                                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1 / P1       | Where do installations come from? Decide where to invest acquisition effort.                               | Newly observed installations by acquisition source.                             | **External/partial:** `studio_app_launch.is_first_launch` on Desktop; `studio_mcp_session_start` has client/plugin context. [A, G]                                                                               | No download campaign or website-to-install bridge. Use acquisition-side data separately; do not infer referrers from the app channel.                                                                        |
| Q2 / P0       | How many reach and finish Welcome, or continue without connecting? Evaluate onboarding.                    | Installations exposed to Welcome; completion within 24 hours of first exposure. | **Partial:** `studio_onboarding_complete.authenticated`; Desktop first-launch marker. [B–D]                                                                                                                      | No welcome exposure, step, or exit-reason signal. Add exposure and completion-path context; include quit-before-completion in the denominator.                                                               |
| Q3 / P0       | Which prompts are seen and acted on? Compare account entry points.                                         | Prompt exposures; report both exposures and distinct installations.             | **Missing:** source is attached only to some auth outcomes. [B–E]                                                                                                                                                | Add visible prompt exposure and auth start; preserve detailed placement and the intended task.                                                                                                               |
| Q4 / P0       | Do people choose login or signup, and do those attempts return successfully? Improve each path.            | Started attempts, split by chosen path and surface.                             | **Partial:** Desktop `studio_wpcom_auth` has `account_type` and `source`; CLI outcomes have no signup path; browser outcomes are missing. [B, C]                                                                 | Add starts, browser parity, and attempt correlation. `account_type=new` means the signup route was chosen, not that a new account was created.                                                               |
| Q5 / P0       | How many fail, cancel, or never return? Separate app errors from drop-off.                                 | All started attempts with a full 24-hour observation window.                    | **Partial:** Desktop callback failures; CLI profile/storage failures. [B, C]                                                                                                                                     | Silent abandonment is absent. Explicit cancellation and browser-open failures need signals. Infer “no observed outcome within 24h”; do not label it confirmed cancellation or failure.                       |
| Q6 / P1       | Which WordPress.com sign-in method was used, and was an account actually created? Evaluate signup quality. | Completed WordPress.com auth/signup journeys.                                   | **External:** Studio knows authorize/signup URL choice, not email/Google/Apple choice or authoritative account creation. [B, C]                                                                                  | Confirm WordPress.com event coverage and a permitted correlation mechanism with that team. Do not derive either fact from Studio button labels.                                                              |
| Q7 / P0       | After connecting, do people finish their intended task? Evaluate whether the prompt helps.                 | Successful auth attempts, grouped by intended task; completion within 24h.      | **Partial:** preview result, sync connect/push, and AI turn events exist but lack an auth-to-task link. [D, F, G]                                                                                                | Carry a journey identifier into the resumed operation and its result. Same-install temporal joins are exploratory, not reliable attribution when tasks overlap.                                              |
| Q8 / P1       | Which creation paths are used and where do they fail? Improve Add site.                                    | Started create/import/connect journeys, split by path.                          | **Partial:** `studio_site_created.flow_type` covers successful provisioning; explicit backup imports have separate results. [F]                                                                                  | Add journey start/results for the user-facing flow. An imported/synced site's blank provisioning step can succeed before population fails.                                                                   |
| Q9 / P1       | How quickly do new installations reach first value? Reduce time to activation.                             | First-observed cohort with complete 24h and 7-day follow-up.                    | **Partial:** timestamps of creation, AI turns, previews, and transfers. [A, F, G]                                                                                                                                | Report milestones separately; add journey context and missing starts. A successful AI turn is an operational milestone, not proof of user satisfaction.                                                      |
| Q10 / P1      | Which AI providers and models get used, and with what reliability? Guide model investment.                 | Dispatched turns; completed turns by provider/model.                            | **Covered for usage; partial for exact completion rate:** `studio_code_message_sent` and `studio_code_turn_completed` include model/provider, outcomes, duration, tool/token summaries, and `ai_session_id`. [G] | No need to add model usage events. Add a turn identifier if exact pairing is required; session ID alone is not a turn ID, and crashes may leave unmatched starts.                                            |
| Q11 / P1      | How many people want AI but cannot begin? Improve provider setup and access.                               | Exposures to a blocking state, by reason and originating task.                  | **Missing before dispatch:** signed-out, payment, eligibility, and quota notices exist; failed turns cover only attempts that reach the runtime. [G, H]                                                          | Record blocker exposure and action, then observe provider-ready/payment-ready state and the next dispatched turn.                                                                                            |
| Q12 / P1      | Do people connect their own key, and does it lead to use? Assess alternate activation.                     | Provider setup starts, with saved settings and first-turn follow-up.            | **Partial:** `studio_setting_ai_provider_change` reports provider and key-presence changes; turn events report actual provider. [E, G]                                                                           | Setup starts, failures, cancellations, and originating task are missing. Saving a key does not establish that a request works.                                                                               |
| Q13 / P1      | Do people buy credits or a publishing plan and resume work? Improve paid handoffs.                         | Checkout starts with mature follow-up, split by purpose.                        | **Partial/external:** `studio_sync_publish_site` / `studio_sync_create_site` are checkout entry clicks; credits have UI return/balance checks without Tracks. [F, H]                                             | Record handoffs and observed readiness separately. Confirmed purchases/revenue require WordPress.com transaction evidence. A return or balance change alone is not a transaction receipt.                    |
| Q14 / P1      | Are preview sharing and publishing dependable? Prioritize reliability work.                                | Observed completed operations, split by channel/version and operation.          | **Covered for observed results; partial for all attempts:** preview create/update and sync push/pull include success, duration, failure buckets. [F]                                                             | Starts/cancels and missing outcomes are needed for full attempt rates. Existing events do not prove a copied link was opened by a recipient.                                                                 |
| Q15 / P1      | Which early actions correlate with return use? Prioritize activation paths.                                | Eligible first-observed cohorts; active on day 1 and day 7.                     | **Partial:** anonymous install IDs and timestamped task events support cohort joins. [A, F, G]                                                                                                                   | Define active as a deliberate qualifying task, not an app/server start or automatic site start. Human-vs-agent initiation is not consistently identified; add actor context before claiming human retention. |
| Q16 / P2      | Are new surfaces adopted and do they work as well? Guide Desktop/browser/CLI/MCP investment.               | Distinct installs per channel with qualifying activity.                         | **Partial:** channels and MCP session/plugin metadata exist. [A, C, G]                                                                                                                                           | Browser auth is a current gap; Spacefast/ACP gaps belong to pending PRs. MCP connection counts are reach, not proof of completed work.                                                                       |

### Authentication entry-point inventory

These are WordPress.com account entry points, not local WordPress Admin auto-login. AI provider
configuration is a separate journey. A prompt can also be reached through a command or annotation
that routes into Settings; current auth outcomes do not retain that upstream motivation.

| Current placement                       | Current `source` on Desktop | Offered path                                                                   | Distinction currently lost                                                     |
| --------------------------------------- | --------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Welcome                                 | `onboarding`                | Continue with WordPress.com uses signup; continue without account is available | Exposure, step progress, skip vs close, and authentication abandonment.        |
| Account menu                            | `settings`                  | Create account / Log in                                                        | Account menu vs actual Settings.                                               |
| Share in site delivery                  | `previews_tab`              | Create account / Log in                                                        | Share tab vs Sharing settings, and header vs menu/command trigger.             |
| Publish in site delivery                | `sync_tab`                  | Create account / Log in                                                        | Publishing intent vs broad historical sync naming and upstream trigger.        |
| Add site → Connect                      | `add_site`                  | Create account / Log in                                                        | Exposure, abandonment, and whether connecting/importing subsequently succeeds. |
| Settings → account card                 | `settings`                  | Signup                                                                         | Account card vs Usage vs AI providers vs account menu.                         |
| Settings → AI providers → WordPress.com | `settings`                  | Signup                                                                         | Whether chat, annotation, the model picker, or Settings itself led here.       |
| Settings → Usage sign-in notice         | `settings`                  | Login                                                                          | Usage entry vs other settings prompts.                                         |
| Settings → Sharing                      | `previews_tab`              | Create account / Log in                                                        | Sharing settings vs a site-specific Share prompt.                              |
| Terminal `studio auth login`            | `cli`                       | Login / paste token                                                            | Pre-token abandonment; no signup classification.                               |

The browser renders the same UI but its `authenticate(signup)` implementation ignores `source` and
does not record equivalent auth outcomes. Historical enum values such as `top_bar`, `site_header`,
and `assistant_tab` should not be assumed to represent current call sites simply because they remain
in the shared type.

## Measurement rules

- **Identity:** use the anonymous installation UUID. Desktop and CLI on the same configuration share
  it; another device or a reset config may be another installation. Do not call distinct IDs “people.”
- **Segments:** keep `channel`, `ui_version`, `app_version`, and platform visible. Exclude known
  `is_a11n=true` activity from product cohorts, but note that signed-out staff may be marked false.
  Missing telemetry and opt-out prevent a claim about all users.
- **Denominators:** `AVG(authenticated)` over onboarding completions measures authentication among
  completers only. It excludes people who quit before completing. No auth outcome does **not** mean
  “never tried”; the user could have abandoned authentication. The existing catalog's stronger
  interpretation should be corrected when implementing the first backlog item.
- **Windows:** use 24h for auth/task conversion and report same-session behavior separately only once
  a session definition exists. Start with distinct installs for cohort reporting and distinct attempts
  for attempt conversion. Exclude immature cohorts; show the eligible count and follow-up window.
- **Activation:** report first successful site setup, first successful AI turn, first preview creation,
  and first successful publish separately, at 24h and 7 days. Do not invent a composite “activated”
  score before seeing which milestones relate to repeat use.
- **Return use:** day 1 is `[24h,48h)` and day 7 is `[168h,192h)` after cohort entry. Use deliberate
  completed tasks; creation, explicit import/export, dispatched AI work, preview operations and sync
  need actor/context filtering before claiming human activity. First observed is not necessarily
  first installed, especially when a user enables telemetry later.
- **Association:** matching by install and timestamp supports exploratory sequences, not causal
  claims. An account connection followed by a push might involve another site or workflow.
- **Delivery:** the sender is a best-effort GET with a five-second timeout and no delivery ledger or
  retry queue. Logs or a successful request do not prove registration, warehouse receipt, or exactly
  once delivery. Missing outcomes can be telemetry loss as well as abandonment.

## Prioritized implementation backlog

These are proposed contracts, not implemented events. Register each event and property for documentation and integrity checks, and independently verify
production receipt before depending on it in analysis. Additive detail should preserve existing names and meanings.

### P0 — Make the account funnel measurable

1. **Add prompt and attempt signals.** Add `studio_account_prompt_viewed` with `source`, `placement`,
   and `intent`; count once per actual visible presentation, not on rerenders or for hidden mounted
   panels. Add `studio_wpcom_auth_started` with those properties plus `auth_flow` (`signup`/`login`)
   and a random `auth_attempt_id`. Record a start when an enabled user action invokes authentication,
   before opening the browser. Re-clicks blocked by an active mutation are not new attempts.
2. **Fix browser parity and outcome semantics.** Extend the shared auth context/interface with optional
   analytics context so both connectors carry the same fields. Reuse one context/result builder in
   `@studio/common`; Desktop IPC and local routes remain thin wrappers. Keep
   `studio_wpcom_auth.success` for stored-token/callback outcomes and add optional attempt/placement/
   intent context. Add `studio_wpcom_auth_cancelled` only for observed cancellation and
   `studio_wpcom_auth_launch_failed` for a failed browser handoff; never manufacture a callback error
   for silence. CLI starts are emitted only after the already-authenticated early return.
3. **Make attribution explicit.** Keep existing `source` values for historical compatibility; add a
   bounded `placement` enum for the rows above and a bounded `intent` enum (`onboarding`, `account`,
   `build`, `annotate`, `share`, `publish`, `connect_site`, `usage`). Preserve intent through routes
   into provider settings. Use attempt-scoped callback correlation rather than copying Desktop's
   last-write-wins singleton into the browser. Missing/expired/restarted contexts remain unknown and
   must not be matched to an arbitrary recent attempt. Keep identifiers free of account/site data.
4. **Measure Welcome exposure and exit.** Add `studio_onboarding_viewed` on actual presentation, with
   bounded `step` (`welcome`/`account`) to accommodate the local two-step version. Extend the existing
   completion event with `completion_path` (`authenticated_continue`/`continue_without_account`/
   `dismissed`) while preserving its `authenticated` snapshot and transition guard. Keep quit without
   completion as an inferred missing outcome. Correct the catalog denominator guidance above.
5. **Connect authentication to its task.** Generate an opaque `journey_id` when a gated task starts,
   retain it through auth/provider setup, and pass it to the resumed operation. Add optional journey
   context to existing AI/preview/connect/push result events; do not emit a second completion at each
   host layer. Record onboarding completion for onboarding intent; account/usage intent can end at
   auth success. Use an opaque turn identifier for exact AI start/result pairing.

Acceptance: Q2–Q5 and Q7 can be queried with explicit denominators and unknown attribution visible.
The first dashboard shows prompt reach, start rate, observed auth success, no observed outcome after
24h, and intended-task completion, split by placement/path/channel/version.

### P1 — Explain activation barriers and repeat use

- Add `studio_code_access_blocked` and `studio_code_access_action` at the visible notice/action,
  with bounded reason and originating intent. Reasons distinguish missing provider, payment method,
  eligibility, credits, offline, and unavailable checks. Record once per visible state transition;
  quota refetches must not inflate exposure counts. Track observed readiness separately from payment.
- Add provider setup start/result events for the alternate-key path, with provider, placement,
  journey, and coarse outcome; reuse existing provider-change and turn events for saved state/use.
  Never include the key, its preview, pasted token, or raw errors.
- Add `studio_checkout_started` with a bounded purpose (`ai_credits`/`publishing_plan`) and journey
  context at the shared handoff. Keep existing publishing checkout-click events for compatibility.
  Record observed readiness as readiness; obtain purchase truth from WordPress.com.
- Add `studio_site_setup_started` / `studio_site_setup_completed` around the full create/import/
  connect flow, with flow type, journey, outcome and coarse failure reason. Keep the lower-level
  `studio_site_created` provisioning event unchanged. Extend operation starts/cancels where needed
  rather than interpreting completed-operation success rates as all-attempt conversion.
- Add bounded actor/trigger context where a CLI operation may be automatic, agent-initiated or
  directly requested. Measure milestone and return cohorts with existing results once that context
  is reliable. Model usage already exists; instrument picker/locked-choice interest only if that
  specific product question becomes a priority.

### P2 — Coordinate external and pending journeys

- Confirm WordPress.com coverage for account creation, sign-in methods, payment and purchases;
  document feasible joins and ownership before proposing an identity change. Do not switch Studio
  from anonymous to authenticated Tracks identity as a side effect of this audit.
- Before Spacefast ships, specify device-auth start/result and publish start/result coverage using
  its own service vocabulary; WordPress.com login events must not absorb it.
- Before ACP ships, resolve its channel/client attribution and reuse the standard turn metrics.
  For the WordPress.com preview backend, verify existing results and version segmentation rather
  than introducing a second event for the same preview operation.

## Original audit verification and release checklist

This report was checked by tracing source and inspecting the PR states/patches described above.
No runtime tests, real authentication, purchases, deployments, or production analytics queries were
performed during the original documentation-only audit. The following is acceptance work for instrumentation
implementation, not a claim that it has passed.

| Scenario                                                                    | Required evidence                                                                                                                                                                                        |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prompt shown, rerendered, hidden, reopened                                  | One exposure per visible presentation; no hidden-panel or rerender inflation. Check Desktop and browser, light and dark.                                                                                 |
| Login/signup succeeds from every entry point                                | Start and stored-token outcome share attempt, placement, path, and intent. Tokens/accounts/URLs never appear in props.                                                                                   |
| Browser popup, fallback paste, cancellation and launch failure              | Same semantics across available paths; explicit cancel/launch failure distinguished from missing return.                                                                                                 |
| CLI already authenticated, pasted-token success/failure, input cancellation | Early return does not count as a new auth attempt; terminal-only failures do not masquerade as callback outcomes.                                                                                        |
| Callback error, profile failure, config failure, timeout                    | Coarse reason and correct outcome; no translated/raw error matching or sensitive text.                                                                                                                   |
| Restart, expired context, parallel windows/tabs, duplicate callback, retry  | No invented attribution; unknown context is visible; duplicate deliveries do not inflate conversion; a real retry has a new attempt.                                                                     |
| Auth returns after the prompt closes or account changes elsewhere           | Persist only valid journey context; do not attribute unrelated account state changes or background work to a waiting task.                                                                               |
| Auth → preview/publish/connect/AI; cancellation or task failure             | One owning operation emits its result; journey retained through the connector/CLI boundary; operation success is distinct from auth success.                                                             |
| Provider key, payment, credits, eligibility gates                           | Missing-provider and paid-access barriers are distinct; saving a key or returning from checkout is not purchase or useful-work success.                                                                  |
| Opt-out, telemetry enabled later, dev/E2E/CI gates                          | Existing wrappers remain authoritative; no new sender bypass. Suppressed events remain absent; cohort limitations documented.                                                                            |
| Registration and production validation                                      | Register all proposed props, then use a permitted release/canary to verify warehouse rows, types, enum values, channel/version attribution and duplicate rates. Development logs alone are insufficient. |

For code changes, run modified-file ESLint/formatting, full typecheck, and affected unit/behavior tests.
Relevant existing coverage includes Desktop auth-context/callback tests, CLI auth tests, browser
analytics-route tests, and shared onboarding tests. Extend those tests for the new contracts and add
browser auth parity coverage. Run agent evals only if implementation changes agent-facing behavior.
Keep pre/post-release cohorts separate; do not backfill historical missing starts as real events.
