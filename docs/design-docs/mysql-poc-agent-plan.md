# MySQL PoC Agent Implementation Plan

This is the step-by-step implementation plan for a proof of concept branch that adds Studio-managed MySQL support to native PHP sites.

The active branch for this worktree is:

```text
implement-mysql-poc
```

## Current Branch Status

This branch has implemented the basic vertical slice:

- database-engine types and site schemas;
- MySQL 8.4.10 macOS ARM64 binary metadata and on-demand installer;
- per-site MySQL process/data directory management;
- MySQL site provisioning and `wp-config.php` constants;
- CLI `site create --database-engine mysql`, `site start`, `site stop`, and
  `wp` support for native PHP sites;
- Studio create-site advanced setting for database engine;
- desktop gates for phpMyAdmin and Sync;
- focused unit tests plus a live CLI smoke test.

Remaining product work is still substantial: cross-platform binary metadata,
MySQL import/export/sync/reprint support, delete cleanup policy, runtime upgrade
policy, security review for credential storage, and product/design review for
the UI.

## Goal

Build a basic but real MySQL path in Studio:

- SQLite remains the default database engine.
- MySQL is opt-in.
- MySQL is supported only for native PHP sites.
- Studio downloads and manages the MySQL runtime on demand, following the same product shape as native PHP runtime downloads.
- A MySQL site can be created, started, stopped, and used with native PHP and WP-CLI.
- Unsupported workflows fail clearly instead of corrupting or silently converting the site.

## Non-goals For The PoC

- Do not make Playground run MySQL.
- Do not migrate existing SQLite sites to MySQL.
- Do not support import/export/push/pull database operations for MySQL in the first slice.
- Do not bundle MySQL inside the app package for the PoC.
- Do not add a full polished UI before the CLI path is working.
- Do not make phpMyAdmin work with real MySQL in the first slice. Hide or gate it for MySQL sites.

## Definition Of Done

The PoC is complete when all of the following are true:

1. `studio site create --runtime native --database-engine mysql ...` creates a native PHP WordPress site backed by a real managed MySQL server.
2. The MySQL runtime is downloaded on demand into the Studio config directory and verified before use.
3. The managed MySQL process starts before WordPress install, WordPress server start, blueprint execution, and native WP-CLI commands that target MySQL sites.
4. MySQL site metadata is persisted in `~/.studio/cli.json` using backwards-compatible optional fields.
5. SQLite sites continue to work unchanged.
6. Playground sites reject `--database-engine mysql` with a clear error.
7. Import, export, push, pull, and phpMyAdmin are gated for MySQL sites with clear messages.
8. The implementation has focused unit tests plus one manual end-to-end CLI smoke test.

## Key Existing Touchpoints

Use these files as the initial map:

- `tools/common/lib/site-runtime.ts`: runtime constants and defaults.
- `tools/common/lib/cli-events.ts`: shared site schema emitted to Studio.
- `apps/cli/lib/cli-config/core.ts`: persisted CLI site schema.
- `apps/cli/commands/site/create.ts`: site creation, SQLite setup, config writes, server start.
- `apps/cli/commands/site/start.ts`: start existing site and currently refresh SQLite.
- `apps/cli/lib/wordpress-server-manager.ts`: chooses Playground vs native PHP child process and ensures PHP binary availability.
- `apps/cli/php-server-child.ts`: native PHP server lifecycle, `ensureWpConfig()`, `installWordPress()`, blueprint execution.
- `apps/cli/lib/native-php/site-setup.ts`: native `wp-config.php` and `wp core install` helpers.
- `apps/cli/lib/run-wp-cli-command.ts`: native and Playground WP-CLI execution.
- `apps/cli/lib/dependency-management/php-binary.ts`: best existing model for on-demand runtime download, hash verification, atomic install slots, and progress.
- `apps/cli/lib/dependency-management/paths.ts`: dependency path helpers under `~/.studio`.
- `tools/common/lib/download-file.ts`: existing streaming download helper.
- `tools/common/lib/extract-zip.ts`: existing zip extractor. MySQL macOS archives are tar.gz, so add or reuse tar.gz extraction separately.
- `tools/common/lib/sqlite-integration.ts` and `apps/cli/lib/sqlite-integration.ts`: current SQLite drop-in install/update logic.
- `apps/studio/src/components/content-tab-overview.tsx`: phpMyAdmin button.

## Implementation Order

Implement in phases. Keep each phase independently reviewable. Do not proceed to broad UI changes until the CLI vertical slice works.

## Phase 0 - Feasibility Spike

Purpose: prove the local runtime assumptions before wiring them deeply into Studio.

Steps:

1. Add a temporary internal helper or hidden CLI command only if it helps validate the runtime quickly. Remove or keep hidden before finalizing the PoC.
2. Confirm the bundled/downloaded native PHP binary has the required MySQL extensions:
   - Ensure PHP is available through `ensurePhpBinaryAvailable()`.
   - Run a PHP one-liner with `runPhpCommand()` checking `extension_loaded( 'mysqli' )`, `extension_loaded( 'pdo_mysql' )`, and `mysqli_get_client_info()`.
   - Fail early if `mysqli` is unavailable.
3. Select one MySQL version for the PoC. Use MySQL 8.4 LTS unless product/legal review prefers MariaDB.
4. Add current-platform download metadata for the first platform being developed on. Keep the metadata shape cross-platform from the start.
5. Download and extract the archive into a temporary directory first.
6. Locate the server binary:
   - macOS/Linux: `bin/mysqld`
   - Windows: `bin/mysqld.exe`
7. Initialize a disposable data directory with `mysqld --initialize-insecure`.
8. Start `mysqld` bound to `127.0.0.1` on a dynamically allocated port.
9. Poll readiness using PHP `mysqli` or `mysqladmin ping`.
10. Verify that PHP can connect using the auth mode MySQL chooses by default. If `caching_sha2_password` fails with Studio's PHP build, change the PoC to create site users with `mysql_native_password` or the compatible plugin available in the selected server version.
11. Stop the process cleanly and verify no child process remains.

Exit criteria:

- A managed `mysqld` can start from the downloaded archive.
- Studio's native PHP can connect with `mysqli`.
- The command sequence is written down in comments or test notes for the next phase.

## Phase 1 - Add Database Engine Types

Purpose: make the database engine explicit without changing existing behavior.

Steps:

1. Add `tools/common/lib/database-engine.ts`.
2. Define constants and schema:
   - `DATABASE_ENGINE_SQLITE = 'sqlite'`
   - `DATABASE_ENGINE_MYSQL = 'mysql'`
   - `databaseEngineSchema = z.enum( [ ... ] )`
   - `getSiteDatabaseEngine( site )` returns `sqlite` by default.
   - `isMySqlSite( site )` helper.
3. Add a MySQL site config schema. Keep fields optional at the top level for backwards compatibility:
   - `host`
   - `port`
   - `databaseName`
   - `username`
   - `password`
   - `serverVersion`
4. Extend `siteDetailsSchema` in `tools/common/lib/cli-events.ts`:
   - `databaseEngine: databaseEngineSchema.optional()`
   - `mysql: mysqlSiteConfigSchema.optional()`
5. Let `apps/cli/lib/cli-config/core.ts` continue using the shared site schema. It is already loose, but the shared schema should know the new fields so Studio events and types are correct.
6. Do not change default site creation yet. Existing sites with no database engine must still be treated as SQLite.
7. Add tests for:
   - default engine is SQLite when omitted.
   - explicit MySQL is recognized.
   - schema accepts old site objects.
   - schema accepts MySQL site objects.

Exit criteria:

- Types compile.
- No behavior changes for existing SQLite/native/Playground sites.

## Phase 2 - Add MySQL Binary Metadata And Installer

Purpose: give Studio a managed, verified, on-demand MySQL runtime.

Steps:

1. Add MySQL binary metadata in common code, mirroring the PHP binary pattern:
   - Suggested file: `tools/common/lib/mysql-binary-metadata.ts`
   - Suggested metadata JSON: `tools/common/lib/mysql-binary-cdn-metadata.json`
2. Include:
   - product name (`mysql`)
   - server version
   - platform
   - arch
   - archive type (`zip` or `tar.gz`)
   - download URL
   - SHA-256
   - expected root directory inside the archive, if any
3. Add path helpers in `apps/cli/lib/dependency-management/paths.ts`:
   - `getMysqlBinaryRoot()`: `~/.studio/mysql-bin`
   - `getMysqlInstallRoot( version )`: `~/.studio/mysql-bin/<version>`
   - `getMysqlServerBinaryPath( version )`
   - `getMysqlAdminBinaryPath( version )`, optional but useful.
   - `getMysqlDataRoot()`: `~/.studio/mysql-data`
4. Add installer logic:
   - Suggested file: `apps/cli/lib/dependency-management/mysql-binary.ts`
   - Export `ensureMysqlBinaryAvailable( version, onProgress? )`.
   - Use `downloadFile()` for downloads.
   - Verify SHA-256 before extraction.
   - Use an atomic install slot like `php-binary.ts`: create the destination directory exclusively; if it already exists, wait for the expected binary.
   - Clean up the destination directory on failure.
5. Add archive extraction support:
   - Reuse `extractZip()` for Windows zip archives.
   - Add `extractTarGz()` for macOS/Linux tar.gz archives.
   - Validate paths during extraction to prevent path traversal, matching the safety posture of `extractZip()`.
6. Copy or move the extracted MySQL root into the install slot so the final layout is stable.
7. Mark `mysqld`, `mysqladmin`, and any helper binaries executable on non-Windows.
8. Add unit tests with mocked download/extract/hash behavior:
   - resolves platform metadata.
   - rejects unsupported platform.
   - verifies hash mismatch removes the install slot.
   - waits when another process owns the install slot.
   - extracts zip and tar.gz through the right helper.

Exit criteria:

- Calling `ensureMysqlBinaryAvailable()` leaves a usable MySQL server binary in `~/.studio/mysql-bin/<version>/...`.
- The installer never downloads MySQL during normal SQLite flows.

## Phase 3 - Add Managed MySQL Process Control

Purpose: start and stop a Studio-owned MySQL server reliably.

Steps:

1. Add a MySQL process module:
   - Suggested file: `apps/cli/lib/mysql/mysql-process.ts`
2. Decide process topology for the PoC:
   - Recommended: one shared managed MySQL process per Studio CLI daemon session.
   - Each site gets a distinct database and user.
   - Data lives under `~/.studio/mysql-data/<server-version>/`.
3. Add data directory helpers:
   - initialize data dir only once.
   - write generated config files under the data root or temp dir.
   - keep pid/socket files under a Studio-owned runtime dir.
4. Initialize the data directory:
   - `mysqld --initialize-insecure --datadir=<data-dir>`
   - Use a startup lock file to avoid two CLI commands initializing the same data dir.
5. Start MySQL:
   - bind to `127.0.0.1`
   - choose an open port dynamically.
   - pass explicit `--datadir`, `--port`, `--bind-address`, `--pid-file`, and a short socket path on macOS/Linux.
   - disable nonessential network surfaces for the PoC where supported.
6. Poll readiness:
   - First choice: connect with PHP `mysqli` using the root/bootstrap account.
   - Alternative: `mysqladmin ping`.
7. Expose:
   - `ensureMysqlServerRunning( logger?, signal? )`
   - `getMysqlConnectionInfo()`
   - `stopMysqlServer()`
8. Register cleanup on CLI daemon/process exit.
9. Add focused tests for:
   - start command arguments.
   - readiness timeout.
   - repeated `ensureMysqlServerRunning()` reuses the running process.
   - stop kills the process and clears state.

Exit criteria:

- Any CLI flow can ask for a managed MySQL server and receive host/port/root connection info.
- Multiple MySQL sites can share the same server process without starting duplicate servers.

## Phase 4 - Add MySQL Site Provisioning

Purpose: create per-site database credentials and write a real MySQL `wp-config.php`.

Steps:

1. Add a site provisioning module:
   - Suggested file: `apps/cli/lib/mysql/mysql-site.ts`
2. Add deterministic but collision-resistant naming:
   - Database name: `studio_<safe-site-id-short>` or similar.
   - Username: `studio_<safe-site-id-short>`.
   - Keep inside MySQL identifier length limits.
3. Add credential generation:
   - Use a random password.
   - Store it in `cli.json` using the existing `encodePassword()`/`decodePassword()` convention for parity with admin passwords.
   - Name the field clearly. This is obfuscation, not secure secret storage; note follow-up work for OS keychain storage.
4. Create helper functions:
   - `createMysqlSiteConfig( siteId, serverInfo )`
   - `provisionMysqlDatabase( mysqlConfig, signal )`
   - `assertMysqlSiteDoesNotExist( mysqlConfig )`
   - `writeMysqlWpConfig( sitePath, mysqlConfig, debugOptions )`
   - `removeStudioSqliteIntegrationForMysql( sitePath )`
5. Provisioning rules:
   - Do not use `CREATE DATABASE IF NOT EXISTS` silently.
   - If the generated database or user already exists, fail with a clear collision message.
   - Create the database with `utf8mb4` charset and `utf8mb4_unicode_ci` or the team's preferred collation.
   - Create a per-site user restricted to `127.0.0.1` or `localhost`, matching the connection host.
   - Grant only the site's database privileges.
6. Use PHP `mysqli` for provisioning SQL in the PoC to avoid requiring the MySQL CLI client to be present or compatible.
7. Handle SQLite files carefully:
   - If `wp-content/db.php` is the Studio SQLite drop-in, remove it for MySQL sites.
   - If `wp-content/db.php` is unknown or marked `@studio-keep`, fail and ask the user to remove/resolve it.
   - Do not delete `wp-content/database` in the PoC. Leave migration/cleanup for later.
8. Write `wp-config.php` constants:
   - `DB_NAME`
   - `DB_USER`
   - `DB_PASSWORD`
   - `DB_HOST` as `127.0.0.1:<port>` unless socket usage is chosen.
   - Keep existing debug constants behavior from native PHP.
9. Update `apps/cli/lib/native-php/site-setup.ts`:
   - Make `ensureWpConfig()` accept database constants or skip default SQLite constants for MySQL.
   - Preserve existing SQLite fallback behavior for non-MySQL sites.

Exit criteria:

- Given a running managed MySQL server, Studio can create isolated DB credentials and a `wp-config.php` that WordPress can use.

## Phase 5 - Wire MySQL Into Site Create

Purpose: create a MySQL-backed WordPress site through the CLI.

Steps:

1. Extend `CreateCommandOptions` in `apps/cli/commands/site/create.ts`:
   - `databaseEngine`
2. Add a hidden or experimental yargs option:
   - `--database-engine sqlite|mysql`
   - default: `sqlite`
3. Validate early:
   - If `databaseEngine === mysql` and runtime is not native PHP, throw a clear error.
   - If offline and the MySQL runtime is not already installed, throw the same style of dependency error as native PHP.
4. Change creation order for MySQL only:
   - Validate site path and CLI config.
   - Copy/download WordPress files.
   - Assign site ID and port.
   - Ensure PHP binary is available.
   - Ensure MySQL binary is available.
   - Start managed MySQL.
   - Provision per-site database and user.
   - Remove Studio SQLite drop-in if present and safe.
   - Write MySQL `wp-config.php`.
   - Build `siteDetails` with `databaseEngine: 'mysql'` and `mysql: ...`.
   - Save config under `lockCliConfig()`.
   - Start the WordPress server unless `--start=false`.
5. Preserve existing SQLite flow:
   - Continue calling `keepSqliteIntegrationUpdated()` for SQLite sites.
   - Continue stripping default DB constants for SQLite sites only where it is currently expected.
6. On failure:
   - If config was not saved, remove files created for a brand-new site.
   - If database/user were created but site save/start failed, drop the created database/user for PoC cleanup if safe.
   - Do not touch existing WordPress directories beyond changes already made.
7. Add tests:
   - MySQL option rejects Playground.
   - SQLite default still calls SQLite setup.
   - MySQL path skips SQLite setup.
   - MySQL path calls binary ensure, process start, provisioning, and config write before saving site.
   - Failure before save cleans up the site directory for newly created sites.

Exit criteria:

- A CLI-created MySQL site can install WordPress successfully.
- SQLite behavior is unchanged by default.

## Phase 6 - Wire MySQL Into Site Start And Native PHP Server

Purpose: existing MySQL sites can start reliably after creation and after app/CLI restart.

Steps:

1. Update `apps/cli/commands/site/start.ts`:
   - Load site.
   - If MySQL site, ensure PHP binary, ensure MySQL binary, and start managed MySQL before starting WordPress.
   - Skip `keepSqliteIntegrationUpdated()` for MySQL sites.
   - Keep existing SQLite behavior unchanged.
2. Update `apps/cli/lib/wordpress-server-manager.ts`:
   - Before native PHP server start, ensure MySQL server is running for MySQL sites.
   - Consider keeping this in `start.ts` and `create.ts` too, but centralizing in the server manager prevents future start callers from forgetting.
3. Update `apps/cli/php-server-child.ts`:
   - When `config.databaseEngine === mysql`, do not run SQLite-style config defaults.
   - Ensure `installWordPress()` sees MySQL constants and can connect.
   - Ensure `run-blueprint` message path also respects MySQL config.
4. Update `apps/cli/lib/types/wordpress-server-ipc.ts`:
   - Add optional database engine and MySQL config fields to `serverConfigSchema`.
5. Update `buildServerConfig()` to pass MySQL fields from `SiteData` to `ServerConfig`.
6. Add tests:
   - MySQL site start skips SQLite setup.
   - `buildServerConfig()` includes MySQL config.
   - native PHP child receives a MySQL config shape.

Exit criteria:

- A saved MySQL site starts after a new CLI/app process.
- Blueprint application during create still runs against the MySQL database.

## Phase 7 - Wire MySQL Into WP-CLI

Purpose: `studio wp ...` and internal WP-CLI calls work for MySQL sites.

Steps:

1. Update `apps/cli/lib/run-wp-cli-command.ts`:
   - Before `runNativeWpCliCommand()` spawns PHP for a MySQL site, ensure managed MySQL is running.
   - Do not change Playground WP-CLI behavior.
2. Make sure WP-CLI uses the site's `wp-config.php` DB constants, not extra CLI flags.
3. Confirm WP-CLI works for:
   - `wp core is-installed`
   - `wp option get siteurl`
   - `wp plugin list`
4. Update config commands that invoke WP-CLI as needed:
   - `apps/cli/commands/config/set.ts`
   - import/export helpers that use WP-CLI should be gated or made MySQL-aware.
5. Add tests:
   - MySQL native WP-CLI ensures MySQL server first.
   - SQLite native WP-CLI does not start MySQL.

Exit criteria:

- Direct WP-CLI commands work against a MySQL site after the web server is stopped and after it is running.

## Phase 8 - Add Unsupported Flow Gates

Purpose: make unsupported MySQL workflows fail clearly in the first PoC.

Steps:

1. Add a shared CLI helper:
   - Suggested file: `apps/cli/lib/database-feature-gates.ts`
   - Example: `assertSqliteOnlySite( site, featureName )`
2. Gate import/export database flows:
   - `apps/cli/lib/import-export/export/export-database.ts`
   - `apps/cli/lib/import-export/export/exporters/default-exporter.ts`
   - `apps/cli/lib/import-export/import/importers/importer.ts`
   - `apps/cli/lib/import-export/import/update-site-url.ts`
3. Gate push/pull/reprint flows where database export/import is assumed.
4. Gate any use of `requireSqliteCliCommand` for MySQL sites.
5. Add clear errors:
   - "This feature is only available for SQLite-backed sites in this MySQL proof of concept."
6. Gate phpMyAdmin:
   - Renderer: hide or disable the phpMyAdmin button in `apps/studio/src/components/content-tab-overview.tsx` for MySQL sites.
   - Backend/router: avoid routing users into the SQLite-adapted phpMyAdmin path for MySQL sites.
7. Add tests:
   - export database rejects MySQL site.
   - import database rejects MySQL site.
   - `requireSqliteCliCommand` path rejects MySQL if reachable.

Exit criteria:

- The PoC does not pretend unsupported database workflows are safe.

## Phase 9 - Minimal Studio UI Hook

Purpose: make the desktop app able to request MySQL site creation only after the CLI path works.

Steps:

1. Keep this phase small and optional for the first PR if the CLI vertical slice is enough.
2. Add database engine to the site creation request shape in the Studio renderer/main/CLI bridge.
3. Use Studio color token rules if any UI is changed:
   - In `apps/studio`, use `--color-frame-*` for colors.
   - Verify light and dark mode manually for UI changes.
4. Add a simple advanced setting, feature flag, or hidden dev-only control for MySQL if product design is not ready.
5. Make SQLite the default and recommended option.
6. Show download progress if the existing CLI logger output already supports it through the current site creation UI.
7. Hide/disable phpMyAdmin for MySQL sites in the overview.

Exit criteria:

- Desktop can create a MySQL site through the same CLI machinery, or the PoC explicitly remains CLI-only with documented next UI steps.

## Phase 10 - Verification

Run verification after code changes.

Required automated checks:

```bash
npx eslint --fix <modified-files>
npm run typecheck
npm test -- <relevant-test-files>
```

CLI build and smoke checks:

```bash
npm run cli:build
node apps/cli/dist/cli/main.mjs site create /tmp/studio-mysql-poc --runtime native --database-engine mysql --name "MySQL PoC" --skip-browser
node apps/cli/dist/cli/main.mjs wp --path /tmp/studio-mysql-poc option get siteurl
node apps/cli/dist/cli/main.mjs site stop --path /tmp/studio-mysql-poc
node apps/cli/dist/cli/main.mjs site start --path /tmp/studio-mysql-poc --skip-browser
node apps/cli/dist/cli/main.mjs wp --path /tmp/studio-mysql-poc db query "SELECT VERSION();"
```

SQLite regression smoke:

```bash
node apps/cli/dist/cli/main.mjs site create /tmp/studio-sqlite-regression --runtime native --name "SQLite Regression" --skip-browser
node apps/cli/dist/cli/main.mjs wp --path /tmp/studio-sqlite-regression option get siteurl
```

Unsupported flow smoke:

```bash
node apps/cli/dist/cli/main.mjs site create /tmp/studio-mysql-poc-sandbox --runtime sandbox --database-engine mysql --skip-browser
```

Expected: clear error that MySQL requires native PHP.

If UI changes are made:

- Verify create-site and overview surfaces in light mode.
- Verify the same surfaces in dark mode.
- Confirm no `--wpds-color-*` color tokens were introduced in `apps/studio`.

## Suggested Test Files To Add Or Update

Start here and adjust to match actual test layout:

- `tools/common/lib/tests/database-engine.test.ts`
- `tools/common/lib/tests/mysql-binary-metadata.test.ts`
- `apps/cli/lib/dependency-management/tests/mysql-binary.test.ts`
- `apps/cli/lib/mysql/tests/mysql-process.test.ts`
- `apps/cli/lib/mysql/tests/mysql-site.test.ts`
- `apps/cli/commands/site/tests/create.test.ts`
- `apps/cli/commands/site/tests/start.test.ts`
- `apps/cli/lib/tests/run-wp-cli-command.test.ts`
- `apps/cli/lib/import-export/tests/database-feature-gates.test.ts`

## Risk Register

Track these risks while implementing:

- Distribution and licensing: Oracle MySQL redistribution/download terms may require review. MariaDB may be simpler if licensing becomes a blocker.
- Archive format: existing dependency helpers extract zip only; macOS MySQL archives are tar.gz.
- macOS quarantine/signing: downloaded binaries may behave differently from bundled signed binaries.
- Auth compatibility: MySQL 8 default auth must work with Studio's bundled PHP `mysqli`.
- Data upgrades: MySQL data directories are version-sensitive. Pin the server version and avoid automatic major upgrades in the PoC.
- Process cleanup: orphaned `mysqld` processes will cause port/data-dir locks.
- Port conflicts: persist host/port assumptions carefully; use dynamic ports and update site config if needed.
- Secrets: `cli.json` password encoding is not strong secret storage. Acceptable for PoC parity, not final security posture.
- Existing `db.php`: deleting an unknown drop-in can break a user site. Fail unless it is clearly Studio's SQLite drop-in.
- Import/export: current database workflows assume SQLite and WP SQLite command behavior.

## Agent Handoff Checklist

Before coding:

1. Read `docs/design-docs/mysql-support.md`.
2. Read `docs/design-docs/mysql-binaries.md`.
3. Read this plan end to end.
4. Confirm the branch is `implement-mysql-poc`.
5. Confirm whether the first platform target is macOS arm64, macOS x64, Windows x64, or all three.
6. Confirm whether the PoC uses Oracle MySQL 8.4 LTS or MariaDB.
7. Do not commit downloaded MySQL archives or extracted binaries.
8. Do not edit WordPress core files inside generated site directories.
9. Keep every config write under the existing `lockCliConfig()` pattern.
10. Keep SQLite default behavior unchanged.

## Recommended First Coding Slice

The first agent should stop after this slice if time is tight:

1. Add database engine types and schema.
2. Add MySQL binary metadata and installer for the current platform.
3. Add managed MySQL process startup and readiness polling.
4. Add a hidden CLI diagnostic command or test helper that proves:
   - MySQL downloads.
   - MySQL initializes.
   - MySQL starts.
   - Native PHP `mysqli` connects.
   - MySQL stops.

That gives the branch a hard technical proof before changing site creation.

The second slice should then wire site create/start/WP-CLI using the proven runtime manager.
