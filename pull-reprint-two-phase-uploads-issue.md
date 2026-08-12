# Restore two-phase uploads download for full Reprint pulls

## Problem

`studio pull-reprint` currently downloads every selected file before it starts
the local site. This is the simplest correct behavior after removing the old
Reprint-specific skipped-files state handling, but a full site's uploads can
make the initial pull take much longer than necessary.

Reprint can generate a runtime that proxies missing uploads from the remote
site while an `essential-files` pull is in effect. Studio previously used that
capability implicitly, then asked Reprint's private state whether uploads were
still pending. That coupling has been removed and must not return.

## Goal

For a full Reprint pull, make the local site available after the essential
files arrive and download uploads in a second phase. The recovery flow must
use Studio-owned selection state and Reprint's public commands only.

## Proposed approach

When the user selected all files, run the first `pull-files` command with
`--filter=essential-files`. Complete the database, flattening, and runtime
steps, then start the local site. Reprint's runtime upload proxy serves
missing uploads from the remote site during this interval.

After the site starts, run a second `pull-files` command for
`--filter=none --only=:wp-uploads:`. Once this command completes, the local
uploads directory supplies those files normally.

Keep partial selections as one pass. For example, a selection containing one
plugin and `uploads/2026` should download those paths in one `pull-files`
command; it should not start a second upload phase.

Store an explicit Studio-owned `uploadsPhasePending` value alongside the
existing saved pull selection. Set it after the first phase completes and
clear it only after the uploads phase succeeds. On a later `pull-reprint`,
resume or reissue the uploads phase instead of starting the first phase again.
This avoids conflicting with Reprint's in-progress command and avoids reading
or writing Reprint's private state files.

## Acceptance criteria

- A full pull starts the local site after essential files, before all uploads
  have downloaded.
- Missing uploads are served through Reprint's remote-upload proxy until the
  upload phase completes.
- A selected subset of files, including a selected uploads subdirectory, uses
  one `pull-files` command.
- An interrupted upload phase can be resumed without repeating the primary
  pull phase or changing Reprint's selection mid-command.
- Studio does not read or write Reprint private state or index files to decide
  whether the upload phase is required.

## Out of scope

- Changing Reprint's filtering or upload-proxy behavior.
- Splitting partial selections into multiple download phases.
