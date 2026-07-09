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
media library of a dedicated WordPress.com site owned by the Studio App & CLI
team, giving stable direct download links without sharing-permission issues.
These supersede the manually fetched files formerly listed on the internal P2
`39997-pb`.

<!-- TODO(STU-1866): record the fixtures site URL and the credentials' vault
location here once the site exists. -->

### Upload rules

- **Zip-wrap every artifact.** WordPress.com media uploads accept `.zip` but
  reject `.tar.gz`, `.wpress` and `.sql`. Upload a plain zip containing exactly
  one file — the real fixture — and record both hashes in the manifest:
  `sha256` for the wrapper you download, `innerSha256`/`innerFilename` for the
  file inside it. (If the team later moves to an SFTP-capable plan, raw files
  can be uploaded to `wp-content/uploads/fixtures/` instead and the
  `innerFilename`/`innerSha256` fields simply omitted.)
- **Use descriptive, date-versioned names**, e.g.
  `jetpack-real-backup-2026-07.tar.gz`.
- **Never replace or delete an uploaded artifact** while any branch references
  it — treat URLs as immutable. To update a fixture, upload a new file and
  point the manifest at it.
- **Copy the final URL from the media library** instead of guessing it:
  WordPress sanitizes filenames on upload (`backup.tar.gz.zip` becomes
  `backup.tar_.gz_.zip`).

### Adding a fixture

1. Generate the artifact and note any content the tests will assert on
   (blog name, post titles, active theme).
2. `shasum -a 256 <artifact>` → manifest `innerSha256`.
3. `zip <artifact>.zip <artifact>` (no directories inside the zip), then
   `shasum -a 256 <artifact>.zip` → manifest `sha256`; `stat -f%z` → `bytes`.
4. Upload the zip via the fixtures site's media library and copy the URL.
5. Open a PR adding the manifest entry — put the expected content strings in
   `description` — plus whatever test consumes the fixture.
6. Green e2e CI on that PR proves the download path end to end.
