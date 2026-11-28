# Safe site publishing

## About this doc

This is a proposal for discussion. The behavior it describes is not implemented. It covers publishing a local site's database to its live site; files are covered only where they affect the data. Until it is built, the live changes guard proposed in Automattic/studio#6045 would stop a database push that overwrites changes made on the live site since the last sync. Pushes have no such protection before that guard ships.

Out of scope: multisite networks, and WordPress.com's own staging-to-production sync.

## Goal

Studio should manage synchronization for the user. At least 95% of publish attempts should complete without a manual pull, a conflict decision, or a manual retry.

The normal flow should be:

**Edit → Publish → Published**

Users can inspect the changes before they publish. Studio should require a decision only when it cannot safely apply those changes.

## The problem

A live site keeps changing while someone works on a local copy. It can receive new posts, comments, orders, and form submissions.

Studio currently replaces the live database when the user publishes content and settings. An older local copy can therefore remove new live data or reverse changes made live. See the [Sync documentation](https://wordpress.studio/docs/sync/).

More frequent pulls do not remove this risk. A live change can arrive after any pull. A pull can also replace unfinished local work.

## Keep track of live changes

Studio should keep three separate versions:

- **Original version:** the state from which local work started.
- **Local version:** the user's current work.
- **Live version:** the latest known state of the live site.

Studio should fetch live changes when the user opens a site, resumes the app, or reconnects to the network. It should also check at intervals while the user works.

Where the server supports it, Studio should fetch only changed items, including deletions. It should reduce checks when the app is idle.

These checks must update a separate copy. They must not replace unfinished local work or change content under the user's cursor. Background fetching must not publish local work.

The check interval affects speed and server load. It does not provide the final safety check.

### Detect changes

WordPress keeps no version number per record and no log of deletions. A post's `post_modified_gmt` changes when the post is saved, but not when only its meta, its terms, or its featured image change, and it has one-second resolution. So "fetch only changed items, including deletions" needs a mechanism that WordPress does not provide on its own.

Two candidates:

- **A content hash** over each record and what belongs to it (post, meta, terms). Studio stores the hash of the original version, and the server compares hashes.
- **An existing change feed.** Jetpack Sync already sends a site's changes, including deletions, to WordPress.com. If WordPress.com can expose that feed per site, Studio can fetch only what changed.

Either way, every write endpoint that publishing uses needs a version check: the write states the hash or version it expects, and the server refuses the write if the live record no longer matches.

## Publish without routine questions

When the user selects Publish, Studio should fetch any remaining changes for the affected items. It should compare the original, local, and live versions.

| Situation                                             | Action                                  |
| ----------------------------------------------------- | --------------------------------------- |
| Only the local version changed                        | Publish the supported local change.     |
| Only the live version changed                         | Keep the live change.                   |
| Both versions have the same change                    | Treat the item as already synchronized. |
| Both versions changed in ways that can safely combine | Combine them and publish.               |
| Both versions changed in incompatible ways            | Ask the user to resolve the conflict.   |

For example, the user edits the About page locally. Two posts and five comments arrive live. Studio publishes the About page without changing those posts or comments.

If two people rewrite the same paragraph, Studio should show that paragraph and ask which version to keep. It should not ask the user to replace a database or repeat a pull.

Automatic merging must use rules for each supported data type. Different text positions do not always mean independent changes.

## Identify records across copies

The comparison above needs to know which local record and which live record are the same item. Numeric IDs cannot provide this. Each database assigns its own IDs, so they diverge as soon as both copies add posts or media.

For example, the user adds an image locally and it gets ID 120. Someone uploads a different image on the live site, and that image also gets ID 120. Studio cannot copy the local image to the live site with its ID. It must create the image on the live site, which assigns a new ID, such as 131. Every local reference to 120 must then point to 131.

This is the central design problem of selective publishing. The other rules depend on it.

Studio needs:

- **A stable identity for each record.** Every supported record needs an identity that is the same in the local copy and on the live site. Some records have a natural key that can match them the first time: templates and template parts (theme and slug), terms (taxonomy and slug), and options (name). A natural key is not an identity, because users can change a slug. After the first match, the ID map below carries the identity, so a term whose slug changed is still the same term, not a deletion and a new term. Posts, attachments, and comments have no natural key. The WordPress `guid` column is not reliable enough, because imports copy it and it contains the URL of the site that created the post.
- **An ID map for each connection.** Studio must record which local ID matches which live ID. It must keep that map correct through pulls, publishes, and failed attempts.
- **Reference rewriting.** When Studio creates a record with a new ID or URL, it must update every reference to the old one.

References to IDs and URLs are stored in many places, including:

- the author of a post or comment: users on WordPress.com are WordPress.com accounts that the local copy does not have
- the parent of a page, attachment, revision, or comment, and the featured image of a post
- block attributes, such as image, gallery, cover, and media-text IDs, synced pattern references, and navigation references
- shortcodes, such as gallery IDs, and media URLs in post content
- menu items, terms, and term relationships
- site settings, such as the front page, the posts page, and the site logo
- plugin data, such as product galleries and custom fields, often as serialized PHP

Studio can rewrite only the references that it understands. A change that relies on plugin data with unknown references is not supported. Studio must report that change instead of publishing it with broken references.

Studio should not build its own merge engine for this. Reprint, the engine Studio's pull already uses to copy a site, recreates records and rewrites references during import. This proposal states what Studio requires from that engine. The Reprint maintainers should decide whether and how it can provide that.

## Preserve live activity

Ordinary publishing must preserve comments, orders, payment records, stock, submissions, accounts, and background job state. Dedicated management actions can change these records.

Some of that state lives on records the user edits. A WooCommerce product is a post, but its stock and sales figures change on the live site with every order. Each field needs one owner: the local copy owns the product description, and the live site owns `_stock` and the sales data. Orders are out of scope, whether WooCommerce stores them in its own order tables or as `shop_order` posts.

Settings need the same care. `wp_options` mixes configuration with runtime and secret state: `siteurl` and `home`, active plugins, cron, transients, and connection tokens such as Jetpack's. Studio should publish only options on an allowlist and never write the others.

Studio must also preserve intentional live deletions. A record missing from an old local copy is not a request to delete it.

A local deletion needs checks for new live data. For example, deleting a post must not silently remove comments received after the original pull.

New local records need safe identities on the live site. Matching numeric IDs must not cause an unrelated live record to be replaced. Related content and media must keep correct references. See [Identify records across copies](#identify-records-across-copies).

Unknown plugin data must remain intact. Studio should identify unsupported local changes early and explain what cannot be published. It must not skip those changes and report a complete publish. This includes changes that depend on references in plugin data that Studio cannot rewrite.

Full database replacement should remain a separate, explicitly destructive action. It must not be an automatic fallback.

## Check again when applying changes

The server must confirm that the affected data has not changed before it applies an update. The check and update must run as one protected operation. A check before upload is not enough.

If a relevant live item changes during publishing, Studio should fetch it again. It can retry automatically if the changes still combine safely. Retries must have a limit and must not create duplicate records or repeat external actions.

Related changes need a consistent result. If only part of a publish succeeds, Studio must show what changed and preserve the remaining work.

Backups remain available for recovery. Studio must not automatically restore the whole database after a failure, because that could remove newer live activity.

After a successful publish, Studio should update the comparison state for the items it synchronized. It must preserve other local edits.

Writes must go through WordPress APIs, not raw SQL. On WordPress.com, SQL written directly to the database bypasses the object cache, the page cache, and the CDN, so visitors would keep seeing the old content. Creating a post can also trigger external actions, such as a newsletter email or a social share. Publishing must decide which of these should run, both on the first write and when it recreates a record, not only on retries.

The app, CLI, and Studio Code must enforce the same rules. AI can explain a conflict or suggest a resolution. Code must enforce the protection.

## Files and code

Publishing data and pushing files are separate today, but they depend on each other. An image block refers to an upload: if the upload is renamed on the live site because a file with that name already exists, the URL in the content changes. Plugins and themes also change data: activating a plugin can create tables, and switching themes changes `theme_mods` and which templates apply.

Studio should push files before the data that refers to them, and update those references when a file's live URL differs. A publish that includes plugin or theme changes should report the data changes they make rather than merging them silently.

## Measure the 95% target

The unit is a user-initiated publish that includes the database. Files-only pushes do not count, because they cannot lose live data.

A publish is seamless when it completes without a manual pull, a conflict decision, or a manual retry, and the user does not publish the same site again within an hour to fix it. Safe automatic retries can count as seamless. Partial success and silently skipped changes cannot.

Measure over 28-day periods with the existing Tracks events (`studio_sync_push`, see [Analytics: Tracks](analytics-tracks.md)), extended with the outcome of each publish. Report unsupported changes, conflicts, connection failures, and manual retries separately. Do not remove difficult cases from the main result.

The baseline comes from the live changes guard (Automattic/studio#6045) once it ships: the share of database pushes it stops (`failure_reason: live_changed`) shows how often a full replacement would have lost live data.

Also measure publishing time. A publish that avoids questions but takes too long is not a good result.

95% is the target for the finished feature. The first scope cannot reach it on its own, because it counts unsupported changes as failures. Each release should report its rate against the baseline instead.

The first scope must include posts, pages, media, and terms together. Posts refer to media and terms, so Studio cannot publish posts safely without them. Templates, styles, settings, and plugin changes may also be necessary to reach 95% across actual use.

Changes that are not supported because of unknown references count as unsuccessful publishes in the main result. On sites with many plugins, this can make the 95% target harder to reach.

The 95% target needs evidence from real use. It does not guarantee that all conflicting edits can be resolved automatically.

## Decisions needed before implementation

- Which change detection should publishing use: content hashes, Jetpack Sync's change feed, or something else? Can every write endpoint it needs check a version?
- Which fields, plugins, and related records can the first version support safely?
- What stable identity will each record have in both copies, and where will Studio store it?
- Where does the ID map for each connection live, and how does it stay correct after a failed or partial publish?
- Can Reprint provide record recreation and reference rewriting for publishing, as it does for import?
- How will Studio preserve existing local work that has no original comparison version? Can WordPress revisions serve as the original version, and what happens to revisions when Studio publishes?
- How will partial pulls and multiple live targets keep separate comparison histories?
- What original data must Studio store, and how will it protect sensitive data?
- What publishing time is acceptable, and when should automatic retries stop?

Until selective publishing is available, the live changes guard proposed in Automattic/studio#6045 is the temporary protection against stale database replacement. The intended experience is automatic synchronization with questions only when a safe decision requires the user.
