# MySQL Support Strategy

This document describes the proposed path for adding real MySQL-compatible
database support to Studio. It is a planning document, not an implemented
contract.

## Proof Of Concept Status

The `implement-mysql-poc` branch contains a first working vertical slice for
macOS ARM64:

- SQLite remains the default engine.
- MySQL is opt-in via CLI and Studio's advanced site creation settings.
- MySQL is limited to native PHP sites; Playground rejects it.
- Studio downloads and verifies MySQL 8.4.10 on demand.
- Each MySQL site gets a Studio-managed data directory, process, database, and
  user.
- Native PHP site start, stop, WordPress install, Blueprint execution, and
  WP-CLI run against the MySQL configuration.
- phpMyAdmin and Sync are gated in the desktop UI for MySQL sites.
- Import/export remains gated through the existing SQLite-integration support
  check.

The branch deliberately keeps MySQL import/export/sync/reprint parity out of
scope.

## Goals

- Keep SQLite as the default database engine for new Studio sites.
- Add MySQL as an opt-in database engine for users who need closer production
  parity.
- Make MySQL work without requiring users to install or configure a database
  server manually.
- Follow the native PHP dependency model: Studio owns the runtime, verifies it,
  installs it into `~/.studio/`, and manages lifecycle.
- Keep Playground sites on SQLite. Real MySQL is scoped to the native PHP
  runtime.

## Non-Goals For The First Version

- Do not require a user-installed MySQL or MariaDB server for the product
  feature.
- Do not bundle MySQL into every Studio install unless offline-first MySQL is a
  hard requirement.
- Do not support MySQL with the Playground/PHP-WASM runtime.
- Do not attempt full import/export/sync/reprint parity in the first vertical
  slice.

## Current Runtime Shape

Studio has two PHP runtimes:

- `native-php`: real OS PHP processes managed by the CLI daemon.
- `playground`: WordPress Playground/PHP-WASM.

The runtime selection flows through `tools/common/lib/site-runtime.ts` and is
used by `apps/cli/lib/wordpress-server-manager.ts` to choose either
`apps/cli/php-server-child.ts` or `apps/cli/playground-server-child.ts`.

SQLite is currently the database assumption. Site creation, start, import,
export, push, and pull all contain paths that install or rely on the SQLite
database integration. Native PHP already includes MySQL client extensions
(`mysqli`, `mysqlnd`, `pdo_mysql`), so the primary gap is not PHP client support.
The missing pieces are a managed database server runtime, site database
configuration, process lifecycle, and feature branching away from SQLite-only
paths.

## Product Direction

The recommended product shape is:

1. SQLite remains the default engine.
2. MySQL is exposed as an opt-in engine in advanced settings and CLI flags.
3. The first time a user selects MySQL, Studio downloads a verified
   MySQL-compatible runtime.
4. Studio installs it into a writable managed location such as
   `~/.studio/mysql-bin/<version>/`.
5. Studio initializes and manages a local data directory.
6. Studio starts a local database process when needed.
7. Each MySQL-backed site gets its own database and credentials.
8. Studio writes real `DB_*` constants into `wp-config.php`.

This keeps the normal site creation path small and offline-friendly while still
giving MySQL users a managed, no-manual-setup experience.

## Why Not Require A Local MySQL Install?

Using a user-installed local MySQL or MariaDB server is useful only as a proof
of concept or developer debug mode. It can prove that Studio's native PHP,
`wp-config.php`, and WP-CLI flows work against MySQL.

It is not acceptable as the product experience because it would push database
installation, credentials, ports, sockets, upgrades, and cleanup onto the user.
Studio should own those details in the same spirit as native PHP.

## Data Model

Add a database engine model shared across the CLI and app:

```ts
databaseEngine: 'sqlite' | 'mysql'
```

Missing values must default to `sqlite` so existing sites remain compatible.

MySQL-backed sites also need managed connection metadata. The exact schema can
evolve, but the first version likely needs:

- database name
- database username
- encoded database password
- host or socket
- port for TCP connections
- charset, default `utf8mb4`
- collation, default empty string unless the runtime chooses one
- runtime version or channel if MySQL binaries are versioned independently

Generated database names must avoid silent collisions. If Studio generates a
name and finds an existing non-empty database with that name, it should choose a
new suffix or fail loudly. It must not silently attach a new site to stale data.

## MySQL Runtime Lifecycle

A managed MySQL runtime needs the same broad stages as native PHP:

1. Resolve the platform and architecture.
2. Find the configured runtime version in checked-in metadata.
3. Download the archive on demand if it is not installed.
4. Verify the archive checksum.
5. Extract into a versioned directory under `~/.studio/`.
6. Initialize a data directory if needed.
7. Start the database process bound to localhost or a private socket.
8. Wait for readiness.
9. Create a per-site database and credentials.
10. Stop the process when no sites need it, or on Studio shutdown.

The first implementation can use one shared Studio-managed database process with
one database per site. A per-site process is easier to isolate but heavier to
run and slower to start. The PoC branch currently uses the per-site model for
simplicity and isolation.

## Site Creation Flow

SQLite sites keep the existing flow.

For MySQL sites, the safe order is:

1. Resolve and persist the site's MySQL configuration.
2. Ensure the managed MySQL runtime is installed.
3. Start or connect to the Studio-managed database process.
4. Preflight the MySQL connection with the same semantics WordPress will use.
5. Create or validate the per-site database.
6. Remove Studio-managed SQLite integration if present.
7. Write real MySQL `DB_*` constants into `wp-config.php`.
8. Run `wp core install` with native PHP.
9. Start the native PHP web server.

The preflight and database creation steps should happen before removing SQLite
or rewriting a working site configuration. A failed MySQL setup should not leave
an existing site half-converted and unbootable.

If a site contains an unknown custom `wp-content/db.php`, Studio should fail
with a clear error instead of deleting it silently.

## Start And WP-CLI Behavior

When starting a MySQL-backed site:

- skip `keepSqliteIntegrationUpdated()`;
- ensure the managed MySQL runtime is installed;
- start the shared database process if needed;
- preflight the per-site database connection;
- start the native PHP web server normally.

Native WP-CLI commands should use WordPress's normal database configuration.
They should not inject the SQLite command shim for MySQL sites.

## Unsupported Flow Gates

SQLite-specific flows must not run against MySQL sites by accident. The first
version should fail clearly for:

- database-only export;
- full export when it includes the database;
- database import;
- push/pull database sync;
- reprint database pull/apply paths;
- phpMyAdmin if it still uses the SQLite adapter.

Content-only export can remain available only if it truly does not touch the
database. Otherwise, it should be gated until verified.

## Phased Implementation Plan

### Phase 0: Runtime Feasibility Probe

Before broader implementation, verify:

- the bundled native PHP has a working `mysqli` extension;
- `mysqlnd` can authenticate against the chosen server version;
- MySQL 8 authentication, especially `caching_sha2_password`, works or produces
  a specific actionable error;
- TCP and socket connection forms behave as expected.

This is the go/no-go check for the rest of the work.

### Phase 1: Data Model And CLI Opt-In

- Add shared database engine constants, schema, and helpers.
- Extend site schemas with optional database engine and MySQL metadata.
- Default missing engine values to SQLite.
- Add hidden CLI flags for database engine and MySQL settings.
- Reject MySQL with the Playground runtime.
- Persist generated database names during site creation.

### Phase 2: Managed MySQL Runtime

- Add MySQL binary metadata similar to PHP binary metadata.
- Add download, checksum verification, extraction, and install helpers.
- Add runtime paths under `~/.studio/mysql-bin/`.
- Add data directory paths under `~/.studio/mysql-data/` or an equivalent
  managed location.
- Add database process start, readiness polling, and stop behavior.
- Add per-site database and credential creation.

### Phase 3: MySQL Site Creation And Start

- Branch site creation by database engine.
- Skip SQLite setup for MySQL sites.
- Write MySQL `wp-config.php` constants.
- Run WP-CLI `core install` against MySQL.
- Start the native PHP web server.
- Add MySQL-aware start behavior.
- Keep SQLite behavior unchanged.

### Phase 4: Safety Gates And Tests

- Gate SQLite-specific import/export/sync/reprint paths.
- Hide or disable phpMyAdmin for MySQL sites until it has a normal MySQL config.
- Add tests for schema defaults, CLI validation, SQLite setup branching,
  `wp-config.php` constants, database name generation, and unsupported flow
  errors.
- Add manual smoke checks for a MySQL-backed site and a SQLite regression site.

### Phase 5: Product Completion

- Add MySQL import/export.
- Add phpMyAdmin with a normal MySQL configuration.
- Add UI controls and site settings display.
- Add delete cleanup options for MySQL databases.
- Add sync/reprint MySQL support.
- Add update and migration handling for MySQL runtime versions.

## Open Decisions

- Use Oracle MySQL or MariaDB as the managed runtime.
- Use one shared database process or one process per site.
- Choose default installation policy: on-demand only, or ship one default
  runtime for offline-first MySQL.
- Decide whether deleting a site should drop its database by default, ask, or
  leave it behind.
- Decide how database credentials should be stored long-term.
- Decide when MySQL should be exposed in the app UI versus CLI-only.

## Recommended First Product Slice

The smallest user-facing slice worth building is:

- SQLite remains the default.
- MySQL is an opt-in engine.
- Selecting MySQL downloads and installs a managed runtime on demand.
- Studio creates and starts one native-PHP WordPress site backed by MySQL.
- Unsupported database import/export/sync actions fail clearly.

That gives users a real MySQL path without adding the MySQL runtime size to
every Studio install.
