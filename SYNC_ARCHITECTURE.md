# Studio Sync Architecture

Overview of how Studio connects to external accounts, pulls production sites locally, and pushes changes back up. Intended as a reference for integrating additional hosting providers or sync backends.

---

## Authentication

Studio uses WordPress.com OAuth2 (implicit grant) to authenticate users.

**Flow:**
1. `tools/common/lib/oauth.ts` — builds the authorization URL (`https://public-api.wordpress.com/oauth2/authorize`) with `response_type=token`, `scope=global`, and `redirect_uri=studio://auth`
2. Main process opens the URL in the system browser via `shellOpenExternalWrapper()`
3. WordPress.com redirects back to the `studio://` custom protocol with an access token in the fragment
4. Main process catches the protocol activation, extracts the token, and emits an `auth-updated` IPC event
5. Renderer's `AuthProvider` (`apps/studio/src/components/auth-provider.tsx`) receives the event, stores the token, and initializes a WPCOM client via `setWpcomClient()`

**Token storage:** `UserData.authToken` in `appdata-v1.json` (macOS: `~/Library/Application Support/Studio/`, Windows: `%APPDATA%\Studio\`). Schema:

```typescript
StoredToken {
  accessToken: string
  expiresIn: number
  expirationTime: number   // epoch ms
  id: number               // WordPress.com user ID
  email: string
  displayName: string
}
```

Token validity is checked on each use. Expired or revoked tokens trigger auto-logout; logout calls `DELETE /studio-app/token` on the WordPress.com REST API to revoke server-side.

---

## Site Discovery & Eligibility

Once authenticated, Studio fetches the user's WordPress.com sites via RTK Query:

**Endpoint:** `GET /me/sites` — filtered to `atomic,wpcom` sites, fields: `name, ID, URL, plan, capabilities, environment_type, jetpack`

Each site is evaluated for sync eligibility (`SyncSupport`):

| Status | Meaning |
|---|---|
| `syncable` | Ready to connect and sync |
| `already-connected` | Connected to a local site |
| `unsupported` | Jetpack-only / non-Atomic |
| `needs-upgrade` | Plan lacks `studio-sync` feature |
| `needs-transfer` | Simple site — activation required |
| `deleted` | Site is deleted |
| `missing-permissions` | User lacks `manage_options` |

Pressable sites (detected via `hosting_provider_guess === 'pressable'`) bypass some plan/feature requirements.

**Relevant files:**
- `apps/studio/src/stores/sync/wpcom-sites.ts` — RTK Query endpoints, response transforms
- `apps/studio/src/modules/sync/lib/sync-support.ts` — eligibility logic

---

## Connected Sites

A "connection" links a WordPress.com remote site to a local Studio site. Connections are stored per authenticated user in `appdata-v1.json`:

```typescript
UserData.connectedWpcomSites: { [userId: number]: SyncSite[] }

SyncSite {
  id: number              // WordPress.com site ID
  localSiteId: string
  name: string
  url: string
  isStaging: boolean
  isPressable: boolean
  environmentType?: string | null
  syncSupport: SyncSupport
  lastPullTimestamp: string | null
  lastPushTimestamp: string | null
}
```

All connection mutations use `lockAppdata()` / `unlockAppdata()` to prevent data corruption from concurrent writes.

**IPC handlers** (`apps/studio/src/modules/sync/lib/ipc-handlers.ts`):
- `connectWpcomSites` — adds connections, marks site as `already-connected`
- `disconnectWpcomSites` — removes connections by `localSiteId` + `siteId`
- `getConnectedWpcomSites` — returns connections, optionally filtered by `localSiteId`
- `updateConnectedWpcomSites` — updates timestamps after sync

---

## Pull: Remote → Local

Pulling clones a production site (or selected parts of it) into a local Studio site.

**Steps:**

1. **Initiate backup** — `POST /sites/{siteId}/studio-app/sync/backup`
   - Body: `{ options: SyncOption[], include_path_list?: string[] }`
   - Response: `{ backup_id }`

2. **Poll backup status** — `GET /sites/{siteId}/studio-app/sync/backup`
   - Waits for `status: 'finished'`, extracts `download_url`

3. **Download archive** — TUS resumable download to a temp path
   - Temp location: `${app.getPath('temp')}/wp-studio-backups/`
   - Large backups (>5 GB) show a warning dialog before proceeding

4. **Import** — `importSite()` IPC handler
   - Stops local server, extracts tar.gz backup, restarts server

5. **Record timestamp** — `lastPullTimestamp` updated in appdata

**Progress states:** `in-progress → downloading → importing → finished`

---

## Push: Local → Remote

Pushing uploads local changes (code and/or database) to the connected production site.

**Steps:**

1. **Export archive** — `exportBackup()` creates a local tar.gz
   - Supports selective sync via `specificSelectionPaths`
   - Hard limit: 5 GB (`SYNC_PUSH_SIZE_LIMIT_BYTES`)
   - Export is cancellable via `AbortController`

2. **Upload via TUS** — chunked upload (500 KB chunks)
   - Endpoint: `https://public-api.wordpress.com/rest/v1.1/studio-file-uploads/{siteId}`
   - Bearer token auth
   - Supports pause (`pauseSyncUpload`) and resume (`resumeSyncUpload`)
   - Progress events emitted over IPC: `sync-upload-progress`, `sync-upload-network-paused`, `sync-upload-manually-paused`, `sync-upload-resumed`

3. **Initiate remote import** — `POST /sites/{siteId}/studio-app/sync/import/initiate`
   - Body includes `import_attachment_id` and sync options

4. **Poll import status** — `GET /sites/{siteId}/studio-app/sync/import`
   - Status progression: `started → initial_backup_started → archive_import_started → finished`

5. **Record timestamp** — `lastPushTimestamp` updated in appdata

**Progress states:** `creatingBackup → uploading → creatingRemoteBackup → applyingChanges → finishing → finished`

---

## Selective Sync

Users can choose which parts of a site to sync. Options are defined in `apps/studio/src/constants.ts`:

| Key | Syncs |
|---|---|
| `all` | Everything |
| `sqls` | Database only |
| `paths` | Specific paths (pull only) |
| `themes` | Themes |
| `plugins` | Plugins |
| `uploads` | Media uploads |
| `contents` | Content (posts, pages, etc.) |

For pull, users can browse the remote file tree before pulling:
- `getLatestRewindId()` — fetches current Rewind/backup ID
- `fetchRemoteFileTree()` — `POST /sites/{siteId}/rewind/backup/ls` returns a `TreeNode[]` tree with types `file | folder | plugin | theme`

---

## Sync Exclusions

The following are always excluded from sync archives:

```
database, db.php, debug.log, sqlite-database-integration,
.DS_Store, Thumbs.db, .git, node_modules, cache
```

Defined in `apps/studio/src/modules/sync/constants.ts`.

---

## State Management

Sync state lives in the Redux store (renderer process):

| Slice / API | Responsibility |
|---|---|
| `sync` slice | Remote file tree state and caching |
| `syncOperations` slice | Pull/push in-progress states and progress percentages |
| `connectedSites` slice | Modal state, selected sites |
| `connectedSitesApi` (RTK Query) | CRUD for connected sites via IPC |
| `wpcomSitesApi` (RTK Query) | WordPress.com site discovery and eligibility |
| `wpcomApi` (RTK Query) | Authenticated WPCOM REST endpoints |

---

## Key File Map

```
tools/common/lib/oauth.ts                          OAuth URL builder
apps/studio/src/lib/oauth.ts                       Token storage/validation
apps/studio/src/components/auth-provider.tsx       Auth state + WPCOM client init
apps/studio/src/stores/wpcom-api.ts                WPCOM client + RTK Query base
apps/studio/src/stores/sync/wpcom-sites.ts         Site discovery + eligibility
apps/studio/src/stores/sync/connected-sites.ts     Connection CRUD
apps/studio/src/stores/sync/sync-operations-slice.ts  Pull/push Redux state
apps/studio/src/stores/sync/sync-api.ts            Remote file tree browsing
apps/studio/src/modules/sync/lib/ipc-handlers.ts   Main-process IPC for sync
apps/studio/src/modules/sync/lib/sync-support.ts   Eligibility logic
apps/studio/src/modules/sync/constants.ts          Exclusions list
apps/studio/src/constants.ts                       Sync options enum, size limit
```

---

## Integration Notes for Additional Providers

To add a non-WordPress.com hosting provider (e.g., a standalone Jetpack host, Pressable direct API, or a generic SSH/SFTP provider):

1. **Auth** — Add a provider-specific OAuth or API key flow. The `StoredToken` shape and `appdata-v1.json` `UserData` type would need to accommodate multiple token namespaces.
2. **Site discovery** — Implement a `getSites()` function analogous to `wpcom-sites.ts` that returns `SyncSite[]` with appropriate `syncSupport` values.
3. **Pull** — Implement `initiatePull()`, `pollPullStatus()`, and a download step. The TUS download layer in `sync-operations-slice.ts` can be reused if the provider supports TUS or standard HTTPS downloads.
4. **Push** — Implement `uploadArchive()` and `initiateRemoteImport()`. The local export step (`exportBackup()`) is provider-agnostic and can be reused directly.
5. **IPC surface** — New providers should expose the same IPC handler names where possible (or add a provider prefix) so the renderer Redux thunks can dispatch against them uniformly.
6. **Eligibility** — Extend `SyncSupport` union type and `sync-support.ts` logic to handle new provider-specific error conditions.
