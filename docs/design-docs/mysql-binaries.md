# MySQL Binary Delivery

This document captures the proposed binary delivery model for a managed MySQL
runtime in Studio. It intentionally mirrors the native PHP runtime design where
possible.

## Native PHP Reference Model

Native PHP is not purely bundled and not purely on-demand.

Packaged Studio builds ship the recommended PHP version under app resources.
On first run, a CLI migration copies that default PHP package into the writable
install location:

```text
~/.studio/php-bin/<patch>/
```

Other PHP versions are downloaded on demand. The downloader:

1. resolves the requested PHP patch version from checked-in metadata;
2. downloads the platform archive;
3. verifies its SHA-256 hash;
4. extracts it into the versioned writable install location;
5. writes or refreshes the adjacent `php.ini` and CA bundle.

The relevant native PHP docs and code are:

- `docs/design-docs/native-php-binaries.md`
- `apps/cli/lib/dependency-management/php-binary.ts`
- `apps/cli/migrations/06-install-bundled-default-php.ts`
- `tools/common/lib/php-binary-cdn-metadata.json`

## Recommended MySQL Model

MySQL should follow the same managed dependency pattern, but the first product
version should prefer on-demand download over bundling into every installer.

Recommended default:

```text
~/.studio/mysql-bin/<version>/
~/.studio/mysql-data/
```

The managed runtime flow should be:

1. User selects MySQL for a site.
2. Studio resolves the configured MySQL-compatible runtime for the current
   platform.
3. Studio downloads the archive if it is not installed.
4. Studio verifies the SHA-256 hash from checked-in metadata.
5. Studio extracts the runtime into `~/.studio/mysql-bin/<version>/`.
6. Studio initializes a managed data directory if needed.
7. Studio starts a local database process bound to localhost or a private
   socket.
8. Studio creates per-site databases and credentials.

This gives users a managed MySQL experience without making every Studio install
pay the size cost.

## PoC Implementation Note

The `implement-mysql-poc` branch starts with one checked-in artifact:

```text
MySQL 8.4.10, macOS 15 ARM64 tar.gz
```

The archive is downloaded on demand, verified with SHA-256, extracted into a
temporary directory, and copied into:

```text
~/.studio/mysql-bin/8.4.10/
```

The installer dereferences archive symlinks while copying. This matters for the
macOS tarball because several binaries link to libraries through archive
symlinks; preserving links to the temporary extraction directory leaves `mysqld`
unable to load after cleanup.

The PoC uses per-site data directories:

```text
~/.studio/mysql-data/<site-id>/
```

Runtime socket and PID paths are kept short under `/tmp` on macOS to stay under
MySQL's Unix socket path limit:

```text
/tmp/studio-mysql-<site-prefix>-<port>/mysql.sock
```

## Bundled Versus On-Demand

There are three delivery options:

### On-Demand Only

Download the MySQL runtime only when the user first creates or switches to a
MySQL-backed site.

Benefits:

- Keeps Studio installers small.
- Avoids large downloads for users who stay on SQLite.
- Still lets Studio fully manage MySQL once selected.

Tradeoffs:

- First MySQL site creation needs internet access.
- Error handling must be strong for download and verification failures.

### Bundle One Default Runtime

Ship one default MySQL runtime with Studio and copy it into `~/.studio/` on
first run, like the default native PHP package.

Benefits:

- MySQL works offline on first use.
- No first-use download delay.

Tradeoffs:

- Adds a large size cost to every Studio installer.
- Most users may never use the bundled database runtime.

### Require User-Installed MySQL

Use a local MySQL or MariaDB installation already present on the machine.

Benefits:

- Fast for proof-of-concept development.
- Avoids immediate packaging and lifecycle work.

Tradeoffs:

- Poor product experience.
- Requires users to manage installation, versions, ports, sockets,
  credentials, upgrades, and cleanup.
- Does not match Studio's native PHP runtime model.

This option is useful for engineering validation only. It should not be the
user-facing feature.

## Current MySQL Archive Sizes

As of 2026-06-29, current Oracle MySQL 8.4.10 compressed archive sizes from the
MySQL CDN were:

| Platform archive | Size |
| --- | ---: |
| macOS 15 ARM64 tar.gz | 167,808,104 bytes, about 160 MiB |
| macOS 15 x86_64 tar.gz | 171,807,202 bytes, about 164 MiB |
| Windows x64 zip | 280,672,277 bytes, about 268 MiB |
| macOS 15 ARM64 DMG | 611,856,822 bytes, about 584 MiB |

The tar.gz archives are the only sensible macOS candidates from a size
perspective. The DMG is much too large for embedding in Studio.

Direct archive URLs checked:

- `https://cdn.mysql.com/Downloads/MySQL-8.4/mysql-8.4.10-macos15-arm64.tar.gz`
- `https://cdn.mysql.com/Downloads/MySQL-8.4/mysql-8.4.10-macos15-x86_64.tar.gz`
- `https://cdn.mysql.com/Downloads/MySQL-8.4/mysql-8.4.10-winx64.zip`
- `https://cdn.mysql.com/Downloads/MySQL-8.4/mysql-8.4.10-macos15-arm64.dmg`

These numbers are compressed archive sizes. Extracted size and final installer
impact may be larger and should be measured before choosing a bundling strategy.

## Packaging Implications

Bundling MySQL would add roughly:

- 160 MiB to each macOS ARM64 build, before installer compression effects;
- 164 MiB to each macOS x64 build, before installer compression effects;
- 268 MiB to each Windows x64 build, before installer compression effects.

If Studio keeps SQLite as the default, an on-demand MySQL runtime avoids this
size tax for most users.

## Metadata And Verification

A MySQL runtime should have a checked-in metadata file similar to PHP:

```text
tools/common/lib/mysql-binary-cdn-metadata.json
```

The metadata should include:

- runtime family, such as `mysql` or `mariadb`;
- upstream version;
- platform and architecture;
- archive URL;
- SHA-256 hash;
- archive format;
- expected binary paths after extraction;
- any platform-specific initialization notes.

Studio should verify every downloaded archive before extraction. Failed
downloads or hash mismatches should remove the partial install directory so a
future run can retry cleanly.

## Runtime Layout

Proposed writable layout:

```text
~/.studio/mysql-bin/<version>/
~/.studio/mysql-data/global/
~/.studio/mysql-runtime/
```

`mysql-bin` stores extracted runtime files. `mysql-data` stores the managed data
directory. `mysql-runtime` can hold transient files such as sockets, PID files,
and generated config files.

The exact layout can change, but binaries, persistent data, and transient
runtime files should stay separate.

## Lifecycle Notes

The database process should:

- bind only to localhost or a private socket;
- use Studio-managed credentials;
- avoid conflicting with user-installed MySQL services;
- be started before MySQL-backed sites start;
- be stopped when no MySQL-backed sites need it, or when Studio exits;
- recover cleanly if a previous Studio process exited unexpectedly.

The first product slice can use one shared database process with one database
per site. This minimizes memory and startup overhead compared with one process
per site.

## Open Questions

- Should Studio use Oracle MySQL or MariaDB?
- Do licensing and redistribution requirements differ enough to prefer one?
- Should a default runtime ever be bundled for offline-first MySQL?
- How should Studio rotate or reset per-site database credentials?
- Should data directories be global per runtime or per site?
- How should Studio handle runtime upgrades that require database migrations?
