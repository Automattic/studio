# Test fixtures

Fixtures shared by the Playwright desktop e2e suite (`apps/studio/e2e/`) and
the CLI integration tests (`apps/cli/**/*.e2e.test.ts`). They live at the repo
root because both runners consume them.

| Path | Tracked | Purpose |
| --- | --- | --- |
| `backups/` | yes | Minimal backup archives (one per import format) generated from the "MyPet" demo site — see [backups/readme.md](backups/readme.md) for provenance and structure. Small enough to keep in git, so PR CI needs no network. |
| `manifest.json` | yes | Declares the **data-heavy** artifacts hosted remotely: name, direct download URL, byte size and SHA-256 hashes. |
| `downloads/` | no (gitignored) | Where `npm run e2e:fixtures` places the verified remote artifacts. Cached in CI keyed on the manifest hash. |

## Downloading the remote fixtures

```
npm run e2e:fixtures                 # warn on failures; affected tests skip
npm run e2e:fixtures -- --require    # fail on any missing fixture (what CI runs)
```

The script (`scripts/prepare-e2e-fixtures.ts`) is idempotent: files that
already match their manifest SHA-256 are skipped, and a corrupted file is
re-downloaded on the next run. The Playwright suite also runs it automatically
via `globalSetup` (`apps/studio/e2e/global-setup.ts`), so `npm run e2e` needs
no manual step.

## Where the remote artifacts are hosted

Data-heavy artifacts (real site exports, large backups) are uploaded to the
media library of **[studioe2efixtures.wordpress.com](https://studioe2efixtures.wordpress.com)**
(blog ID `256087724`, Simple platform), a dedicated WordPress.com site that
gives stable direct download links without sharing-permission issues. These
supersede the manually fetched files formerly listed on the internal P2
`39997-pb`.

The site was created for STU-1866, carries an `a8c` sticker documenting its
purpose, and belongs to the Studio (YOLO) team — @gcsecsey administers it; ask
to be added as an admin rather than sharing credentials. Uploads happen
manually through the media library (Calypso/wp-admin) — programmatic media
uploads (MCP/REST) reject zips on Simple sites.

### Upload rules

- **Zip-wrap every artifact.** WordPress.com media uploads accept `.zip` but
  reject `.tar.gz`, `.wpress` and `.sql`. Upload a plain zip containing exactly
  one file — the real fixture — and record both hashes in the manifest:
  `sha256` for the wrapper you download, `innerSha256`/`innerFilename` for the
  file inside it. (If the team later moves to an SFTP-capable plan, raw files
  can be uploaded to `wp-content/uploads/fixtures/` instead and the
  `innerFilename`/`innerSha256` fields simply omitted.)
- **Name the wrapper with a single extension and a date**, e.g.
  `jetpack-real-backup-2026-07.zip` — not `jetpack-real-backup.tar.gz.zip`.
  Single-extension names are served under their exact name; multi-dot names
  get sanitized on upload (`backup.tar.gz.zip` → `backup.tar_.gz_.zip`). The
  inner file keeps its real name via `innerFilename`.
- **Never replace or delete an uploaded artifact** while any branch references
  it — treat URLs as immutable. To update a fixture, upload a new file and
  point the manifest at it.
- **Copy the final URL from the media library** rather than guessing it, and
  verify the `sha256` of the downloaded wrapper before recording it.

### Adding a fixture

1. Generate the artifact and note any content the tests will assert on
   (blog name, post titles, active theme).
2. `shasum -a 256 <artifact>` → manifest `innerSha256`.
3. `zip <artifact-name>-<date>.zip <artifact>` (single-extension wrapper name,
   no directories inside the zip), then `shasum -a 256 <wrapper>.zip` →
   manifest `sha256`; `stat -f%z <wrapper>.zip` → `bytes`.
4. Upload the zip via the fixtures site's media library and copy the URL.
5. Open a PR adding the manifest entry — put the expected content strings in
   `description` — plus whatever test consumes the fixture.
6. Green e2e CI on that PR proves the download path end to end.
