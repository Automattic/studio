Last updated: 2026-11-17 17:47

# Proposal: publish local changes without losing live data

Status: draft for discussion. The proposed behavior is not implemented.

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

- **A stable identity for each record.** Every supported record needs an identity that is the same in the local copy and on the live site. The WordPress `guid` column is not reliable enough for this.
- **An ID map for each connection.** Studio must record which local ID matches which live ID. It must keep that map correct through pulls, publishes, and failed attempts.
- **Reference rewriting.** When Studio creates a record with a new ID or URL, it must update every reference to the old one.

References to IDs and URLs are stored in many places, including:

- the parent of a page or attachment, and the featured image of a post
- block attributes, such as image, gallery, cover, and media-text IDs, synced pattern references, and navigation references
- shortcodes, such as gallery IDs, and media URLs in post content
- menu items, terms, and term relationships
- site settings, such as the front page, the posts page, and the site logo
- plugin data, such as product galleries and custom fields, often as serialized PHP

Studio can rewrite only the references that it understands. A change that relies on plugin data with unknown references is not supported. Studio must report that change instead of publishing it with broken references.

Studio should not build its own merge engine for this. Reprint already recreates records and rewrites references during import. This proposal states what Studio requires from that engine. The Reprint maintainers should decide whether and how it can provide that.

## Preserve live activity

Ordinary publishing must preserve comments, orders, payment records, stock, submissions, accounts, and background job state. Dedicated management actions can change these records.

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

The app, CLI, and Studio Code must enforce the same rules. AI can explain a conflict or suggest a resolution. Code must enforce the protection.

## Measure the 95% target

A seamless publish completes all intended changes without requiring the user to manage synchronization. Safe automatic retries can count as seamless. Partial success and silently skipped changes cannot.

Measure all user-initiated publish attempts over a defined period. Report unsupported changes, conflicts, connection failures, and manual retries separately. Do not remove difficult cases from the main result.

Also measure publishing time and data-loss incidents. A publish that avoids questions but takes too long is not a good result.

The first scope must include posts, pages, media, and terms together. Posts refer to media and terms, so Studio cannot publish posts safely without them. Templates, styles, settings, and plugin changes may also be necessary to reach 95% across actual use.

Changes that are not supported because of unknown references count as unsuccessful publishes in the main result. On sites with many plugins, this can make the 95% target harder to reach.

The 95% target needs evidence from real use. It is not a guarantee that all conflicting edits can be resolved automatically.

## Decisions needed before implementation

- Can the backend provide efficient change detection and protected writes?
- Which fields, plugins, and related records can the first version support safely?
- What stable identity will each record have in both copies, and where will Studio store it?
- Where does the ID map for each connection live, and how does it stay correct after a failed or partial publish?
- Can Reprint provide record recreation and reference rewriting for publishing, as it does for import?
- How will Studio preserve existing local work that has no original comparison version?
- How will partial pulls and multiple live targets keep separate comparison histories?
- What original data must Studio store, and how will it protect sensitive data?
- What publishing time is acceptable, and when should automatic retries stop?

Until selective publishing is available, a guard can stop stale database replacement. That is temporary protection. The intended experience is automatic synchronization with questions only when a safe decision requires the user.
