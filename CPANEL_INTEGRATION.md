# cPanel UAPI Integration — Implementation Plan

This document outlines a plan to add cPanel as a second hosting provider in WordPress Studio, enabling users to pull a production WordPress site hosted on cPanel into a local Studio environment (and, later, push local changes back). It is intended for team review and approval before implementation begins.

For background on how the existing WordPress.com sync works, see [SYNC_ARCHITECTURE.md](SYNC_ARCHITECTURE.md).

---

## What cPanel UAPI Is

cPanel's UAPI is a JSON-over-HTTP API available on every cPanel hosting account. It gives programmatic access to file management, MySQL databases, DNS, email, and more. Unlike WordPress.com's OAuth2 flow, it uses API tokens tied to a specific cPanel account.

**Request format:**
```
GET/POST https://<hostname>:2083/execute/<Module>/<Function>?param=value
Authorization: cpanel <username>:<api_token>
```

**Response format:**
```json
{ "status": 1, "data": { ... }, "errors": null }
```

API tokens are created by the user in cPanel → Security → Manage API Tokens. They are long-lived (permanent until revoked) and scoped to the account — not to a specific application.

---

## Proposed Feature Scope

### v1: Pull only (cPanel → Local Studio)

Given the roadblocks described below, v1 should be limited to pulling a site down locally. This is the highest-value use case (local dev environment from production) and avoids the critical gaps that affect push.

- User connects a cPanel site by entering credentials
- Studio pulls the WordPress file tree and database to create a local site
- No selective sync — full site only
- No push back to cPanel in v1

### v2: Push (Local Studio → cPanel)

Deferred until the database import gap is resolved (see roadblocks). Files-only push may be feasible in v2 as an interim step.

---

## Implementation Plan

### 1. Connection Setup

**UI changes:**
- Add a "Connect cPanel Site" entry point in the sync tab alongside the existing WordPress.com connect button (`apps/studio/src/modules/sync/index.tsx`)
- New `CpanelCredentialsModal` component prompts for:
  - cPanel hostname (e.g. `mysite.com` or `server.host.com`)
  - cPanel port (default `2083`, configurable for non-standard setups)
  - cPanel username
  - API token (link to cPanel docs on how to create one)
  - WordPress root path (e.g. `public_html`, `public_html/blog`)
  - MySQL database name (list fetched via API after credentials are validated)

**Connection validation:**
- On submit, call `Fileman::list_files dir=<wp_path>` — success confirms credentials and path are valid
- Call `Mysql::list_databases` to populate the database name dropdown

**Storage:**
- Add `connectedCpanelSites: { [localSiteId: string]: CpanelSyncSite[] }` to `UserData` in appdata
- New type:
  ```typescript
  CpanelSyncSite {
    id: string               // generated UUID
    localSiteId: string
    hostname: string
    port: number             // default 2083
    username: string
    apiToken: string         // stored in appdata (see security note)
    wpPath: string           // e.g. "public_html"
    dbName: string
    lastPullTimestamp: string | null
    lastPushTimestamp: string | null
  }
  ```
- All appdata writes use `lockAppdata()` / `unlockAppdata()` (existing pattern)

**New IPC handlers** (following existing patterns in `apps/studio/src/modules/sync/lib/ipc-handlers.ts`):
- `connectCpanelSite` — validate + save connection
- `disconnectCpanelSite` — remove from appdata
- `getConnectedCpanelSites` — retrieve connections

---

### 2. Pull Flow

**Step 1 — Compress WordPress files on server**

```
POST /execute/Fileman/compress
  files-0=<wp_path>
  type=tar.gz
  dest-dir=<wp_path>/../.studio-tmp/
  dest-file=studio-backup-<timestamp>.tar.gz
```

Creates a server-side archive. The `Fileman::compress` endpoint supports `tar.gz` output.

**Step 2 — Download the archive**

This is where the biggest gap exists (see roadblocks). The intended approach is to use the cPanel file download URL:

```
GET https://<host>:<port>/download?skipencode=1&dir=<tmp_dir>&file=<archive.tar.gz>
Authorization: cpanel <username>:<api_token>
```

This URL is part of the cPanel web interface, not a documented UAPI endpoint, and may not be stable across cPanel versions.

**Step 3 — Export database**

```
GET /execute/Mysql/dump_database_schema?dbname=<db_name>
```

Returns the full SQL dump as the response body. Save to a `.sql` file locally.

**Step 4 — Assemble Studio-compatible archive**

The existing `importSite()` IPC handler expects a `tar.gz` in a specific layout. Combine the downloaded WordPress files and the SQL dump into the correct format locally before importing.

This may require a new adapter function, or the cPanel-specific pull handler can call `importSite()` with a pre-assembled path.

**Step 5 — Import**

Reuse the existing import pipeline:
- Stop local server (`stopServer(localSiteId)`)
- Call `importSite({ id: localSiteId, backupFile: { path, type: 'application/tar+gzip' } })`
- Start local server (`startServer(localSiteId)`)
- Update `lastPullTimestamp` in appdata

**Progress states (proposed):**

| State | Description |
|---|---|
| `compressing` | Creating archive on server |
| `downloading` | Downloading archive to local temp |
| `exporting-db` | Fetching SQL dump |
| `importing` | Applying to local Studio site |
| `finished` | Complete |
| `failed` | Error with message |
| `cancelled` | User cancelled |

---

### 3. Redux / State Management

New Redux slice `cpanelSyncOperations` (parallel to `syncOperations` in `apps/studio/src/stores/sync/sync-operations-slice.ts`):
- `pullStates: { [localSiteId: string]: CpanelPullState }`
- Thunk: `pullCpanelSiteThunk` — orchestrates steps 1–5 above
- AbortController registry for cancellation (same pattern as existing `SYNC_ABORT_CONTROLLERS` map)

---

### 4. UI Reuse

The following existing components can be reused with minimal changes:
- `SyncConnectedSiteSection` — display layout for a connected site
- Progress bar and status message display from `SyncConnectedSitesSectionItem`
- The `ContentTabSync` tab shell in `apps/studio/src/modules/sync/index.tsx`

New components needed:
- `CpanelCredentialsModal` — credential entry form
- `CpanelConnectedSite` — displays a connected cPanel site (hostname, last pull)

---

## Roadblocks & Missing Pieces

These are the gaps that require design decisions before implementation. They are listed in order of severity.

---

### CRITICAL — No UAPI endpoint to import a database

**Impact:** Push to cPanel is blocked entirely. Pull is unaffected (export-only SQL).

**Detail:** `Mysql::dump_database_schema` exports SQL, but there is no corresponding `Mysql::import_database` or `Mysql::execute_sql` UAPI endpoint. cPanel does not expose SQL execution through its standard user API.

**Workaround options:**

| Option | Feasibility | Notes |
|---|---|---|
| Upload a PHP script that imports SQL, trigger via HTTP, delete it | Possible | Security risk; fragile; requires PHP `exec()` or `mysqli` + large SQL chunking |
| Require SSH access and run `mysql` CLI | Possible | Separate credential flow; not all hosts allow SSH |
| WHM/reseller API | Not viable | Requires reseller-level access, not standard cPanel |
| phpMyAdmin import URL | Fragile | Relies on phpMyAdmin being installed and session-authenticated |
| WP-CLI via SSH (`wp db import`) | Best long-term | Requires SSH and WP-CLI; out of scope for UAPI-only integration |

**Recommendation:** Defer database push to a follow-up. v1 pull-only avoids this gap entirely.

---

### CRITICAL — No documented binary file download API

**Impact:** Downloading large compressed archives (the WordPress file tree) relies on an undocumented URL.

**Detail:** `Fileman::get_file_content` is limited to small text files. There is no documented UAPI endpoint for downloading binary files or large archives. The cPanel web UI uses:

```
GET /download?skipencode=1&dir=<dir>&file=<filename>
```

This is part of the cPanel web interface layer, not the UAPI. It accepts the same `Authorization: cpanel` header but is not documented as a stable endpoint and could change between cPanel versions.

**Workaround options:**

| Option | Feasibility | Notes |
|---|---|---|
| Use the `/download` URL anyway | Likely works | Undocumented; test against cPanel 110+ |
| Fall back to SFTP/FTP for transfer | Works reliably | Requires additional credentials; broader scope |
| Require user to manually export and provide a URL | Poor UX | Defeats the purpose |

**Recommendation:** Use the `/download` URL for v1 with a documented caveat. Investigate SFTP as a v2 enhancement.

---

### SIGNIFICANT — PHP upload size limits block large push archives

**Impact:** Pushing large sites to cPanel via `Fileman::upload_files` will fail if the archive exceeds the server's PHP upload limits.

**Detail:** `Fileman::upload_files` is a PHP multipart endpoint subject to `upload_max_filesize` and `post_max_size`, which default to 2–32 MB on most hosts. A typical WordPress site with media uploads can be several GBs.

**Workaround options:**

| Option | Feasibility | Notes |
|---|---|---|
| Chunked upload + server-side reassembly | Complex | No UAPI chunked upload support; would require a PHP helper script |
| SFTP upload | Reliable | Outside UAPI scope; needs separate credentials |
| Warn user and fail gracefully | MVP | Inform user their host's PHP limits are too low |

**Recommendation:** Surface the limit as an error with a message linking to documentation on raising `upload_max_filesize`. SFTP support is the proper long-term solution.

---

### SIGNIFICANT — No server-side job polling for push progress

**Impact:** Push progress tracking is limited to upload percentage. Post-upload extraction gives no feedback.

**Detail:** The WordPress.com sync uses a server-side job (`/studio-app/sync/import`) that reports progress through file import phases. cPanel file operations are synchronous at the API level — `Fileman::extract` blocks until done, but for large archives this could take many minutes, and there is no status endpoint to poll.

**Workaround:** Client-side progress only: upload % during upload, then an indeterminate spinner during extraction.

---

### MODERATE — No selective sync

**Impact:** Users cannot pull only the database, or only plugins — always a full-site pull.

**Detail:** The WordPress.com pull uses Jetpack Rewind's `/rewind/backup/ls` to show a browsable file tree and let users select specific paths. cPanel `Fileman::list_files` only lists one directory at a time; building a recursive tree for a large WordPress install would require dozens of API calls and significant latency.

**Recommendation:** Full-site only for v1. Selective sync could be added in v2 using a background tree fetch with caching.

---

### MINOR — Credential security

**Detail:** cPanel API tokens grant full account access (file management, DNS, email, databases). Storing them in `appdata-v1.json` gives the same access level as the user's cPanel password. On macOS, `appdata-v1.json` is not encrypted (unlike Windows where DPAPI is used).

**Recommendation:** Display a clear warning in the connection UI. Explore OS keychain storage for the token (separate from the appdata JSON) as a follow-on.

---

### MINOR — Non-standard ports and reverse proxies

**Detail:** cPanel defaults to port 2083 for HTTPS. Some hosts use custom ports, subdomain-based access (`cpanel.myhost.com`), or reverse proxies that alter the URL structure.

**Recommendation:** Make port configurable in the credentials form. Allow full hostname/URL input so users can paste their actual cPanel access URL.

---

## Files Affected

| File | Change |
|---|---|
| `apps/studio/src/modules/sync/index.tsx` | Add cPanel connect entry point |
| `apps/studio/src/modules/sync/components/CpanelCredentialsModal.tsx` | New credential form component |
| `apps/studio/src/modules/sync/components/CpanelConnectedSite.tsx` | New connected site display |
| `apps/studio/src/modules/sync/lib/ipc-handlers.ts` | Add cPanel IPC handlers |
| `apps/studio/src/stores/sync/cpanel-sync-operations-slice.ts` | New Redux slice for pull state |
| `apps/studio/src/stores/sync/cpanel-sites.ts` | RTK Query API for cPanel connections |
| `apps/studio/src/ipc-handlers.ts` | Register new IPC handler exports |
| `apps/studio/src/preload.ts` | Expose new IPC methods via contextBridge |
| `apps/studio/src/storage/storage-types.ts` | Add `CpanelSyncSite`, extend `UserData` |
| `apps/studio/src/constants.ts` | Add cPanel-specific constants |
| `tools/common/types/` | Add shared `CpanelSyncSite` type if needed by CLI |

---

## Questions for Team Review

1. **File download approach** — Is using the undocumented `/download` cPanel URL acceptable for v1, or should we require SFTP from the start?
2. **Database push deferral** — Agreed to ship v1 as pull-only, with push requiring a separate spike on the DB import gap?
3. **Credential storage** — Should we store the cPanel API token in the OS keychain rather than appdata, given its broad account access?
4. **PHP upload limits** — For push (v2): fail with a clear error message, or invest in SFTP support upfront?
5. **Scope of "cPanel"** — Should this also target DirectAdmin or Plesk (which have similar APIs), or stay cPanel-specific for v1?
