Last updated: 2026-11-16 23:09

# Proposal: publish local changes without replacing live activity

Status: draft for discussion. This document proposes behavior; it does not implement a new publishing path or establish that the backend supports it today.

## Problem

A local copy becomes stale while its live site keeps running. Someone can publish a post, leave a comment, submit a form, create an account, or place an order after the last pull. Publishing the older database can remove that activity, revert edits, or restore records someone deliberately deleted.

This proposal follows a report of posts disappearing after two or three days of local work followed by a database push. The incident has not been independently reproduced. Comments and other operational data are additional risks, not reported losses from that incident.

Remembering to pull more often does not solve the problem. A live change can arrive immediately after a pull, and another pull can overwrite unfinished local work. Backups help recover from a bad publish but do not prevent it; restoring one can also discard activity received afterward.

## Current behavior

The [published Sync documentation](https://wordpress.studio/docs/sync/) states that publishing content and settings replaces the whole live database and triggers a full-site backup before syncing.

The following client behavior was checked against trunk commit `226d98405`:

- [Publish options](../../apps/ui/src/features/sync/publish-panel/options.ts) treat content and settings as the `sqls` selection. Choosing files is more granular; choosing database content does not select individual posts or fields.
- [Import initiation](../../packages/providers/wpcom/sites/api.ts) sends the archive attachment, sync categories, and optional file paths. It sends no expected remote revision.

These observations describe the client contract. They do not establish all server-side import exceptions, preservation rules, or concurrency guarantees. Those need investigation with the backend owners.

## Proposed default: publish reviewed changes

Ordinary Publish should apply the user's selected local changes to the current live site. Whole-database replacement should be a separate action whose destructive scope is explicit, rather than a fallback when selective publishing cannot handle something.

For example:

1. Pull the site on Monday.
2. Two posts are published and five comments arrive live on Tuesday.
3. Edit the About page locally on Wednesday.
4. Publish the About page update. Tuesday's posts and comments stay intact.

If About was also edited live, Studio should show the conflict before changing it.

### Keep the original state

Retain a baseline from the snapshot actually pulled, associated with the local site and remote target. Compare that baseline with both the local work and the current live state. A last-pull timestamp or the latest backup identifier alone is not enough.

Files-only and partial pulls must not mark the whole database as current. A local site connected to production and staging needs separate target histories. Existing local work without a trustworthy baseline needs an explicit reconciliation path that preserves it; silently treating today's live site as its original state would hide conflicts.

### Review the changes

| Difference from the baseline                     | Proposed behavior                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| Changed only live                                | Keep the live version.                                              |
| Changed only locally, within supported scope     | Offer the local change for publication.                             |
| Both sides reached the same result               | Treat it as already reconciled.                                     |
| Both sides changed differently                   | Show a conflict; do not silently choose a winner.                   |
| One side deleted an item the other changed       | Show a conflict, including affected dependencies.                   |
| An item was created only live after the baseline | Preserve it; absence from the local copy is not a deletion request. |

Initially, conflicting changes to the same post or structured value can require review as a whole. Automatic field or block merges should be added only where their semantics are understood. The review should distinguish creates, updates, deletions, and unsupported changes.

Deleting a post that received new comments must expose those comments as part of the consequence. New local records also need remote identities and correctly mapped references: a matching numeric ID does not prove that two independently created posts are the same post.

### Preserve live activity

| Data                                                                                                                              | Proposed treatment during ordinary publishing                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Posts, pages, templates, navigation, styles, and supported settings                                                               | Publish selected changes with conflict checks and dependency handling.                                            |
| Comments and moderation, orders and payment state, stock, submissions, accounts and access, carts, jobs, and integration progress | Preserve live state. Changes to these belong in dedicated management workflows.                                   |
| Unknown plugin data                                                                                                               | Preserve live data and report unsupported local changes. Block dependent changes that cannot be published safely. |
| Caches and generated indexes                                                                                                      | Invalidate or rebuild where supported, rather than copy local state.                                              |
| Selected files and media                                                                                                          | Check conflicts and preserve references between files and content.                                                |

This is a policy by meaning, not a list of excluded tables. Content, configuration, and operational records can share storage. Some plugin data needs coordinated changes across several records. A file or API update can also trigger hooks or migrations, so selective writes alone do not prove that unrelated data is safe.

## Apply-time protection and recovery

The server must validate the expected state when it applies a change. Checking once before an upload leaves a window in which the live site can change again. A changed post should invalidate that post's reviewed update; an unrelated new comment should not block publishing a different page.

Dependent changes need a defined consistency boundary. If an operation fails partway through, Studio must report what actually applied, preserve unapplied work, and allow retries without duplicate records or repeated external effects. Standard REST updates should not be assumed to provide these guarantees without verification.

Keep the existing backup protection and record a publication result that supports reconciliation. Do not automatically restore the whole database after a partial failure: that could erase newer live activity. Refresh baselines only for content actually reconciled, leaving other local edits and their original comparison state intact.

The same rules must apply through the app, CLI, and Studio Code. The agent can explain conflicts and suggest resolutions; deterministic code must enforce publication scope and concurrency checks. Non-interactive callers should receive a structured conflict or unsupported-operation result instead of bypassing review.

## Immediate safeguard and initial scope

A guard against stale whole-database publication is useful before selective publishing is available. If live data diverged from the actual pull baseline, or freshness cannot be established, ordinary database publishing should stop and preserve both copies for reconciliation. File-only publishing remains an option when the intended work is entirely in files.

That guard needs a trustworthy backend change signal and coordination with writes during import. An age warning or client-only preflight is partial protection, not a guarantee. Busy sites could hit the guard repeatedly, which is why it is a safeguard rather than the final publishing experience.

The first selective publishing scope should be posts and pages, including an explicit supported set of metadata, taxonomy relationships, and media references. Unsupported fields or plugin dependencies must be visible before publication. Templates, styles, broader settings, and plugin-specific support can follow separately.

This proposal does not include a generic SQL merge, automatic pulling over unfinished work, automatic reconciliation of arbitrary plugin schemas, or changes to unrelated hosting providers. WordPress.com and Pressable capabilities must be assessed separately before claiming support for either.

## Scenarios a future implementation must demonstrate

These are acceptance scenarios, not tests passed by this documentation PR.

- A local page update preserves posts, comments, and operational records created or changed live after the pull.
- Divergent edits to the same supported entity require resolution; identical edits do not.
- Live deletions are not silently reversed, and local deletions expose new live dependencies.
- A live edit after review is detected at apply time without blocking unrelated activity.
- Independently created local and live posts with the same numeric ID remain separate and keep correct references.
- An interrupted publication can resume without duplicate creates; its result identifies applied and unapplied work.
- Missing baselines, partial pulls, and multiple remote targets cannot produce false freshness.
- Unsupported plugin data stays intact, and Studio does not report its dependent feature as successfully published.
- App, CLI, and agent entry points enforce the same protection.

## Questions before implementation

- What backend signal can identify meaningful changes to the actual pulled snapshot, including plugin-owned data, without treating every cache write as a conflict?
- What conditional-write and consistency guarantees can WordPress.com and Pressable provide? How are concurrent comments, background jobs, and external callbacks handled during imports?
- Which post/page fields and dependencies can the first version support, and how should plugin hooks and schema migrations constrain eligibility?
- How much baseline data must Studio retain, for how long, and how is sensitive data excluded or protected?
- What reconciliation experience should existing local sites without a baseline get?
- How should intentional full replacement and initial publication to an empty site work without becoming a shortcut around ordinary publishing protections?

Agreement on those boundaries should precede implementation. The draft is intended to establish the publishing behavior and the backend questions, without implying that a client warning alone solves the problem.
