# Push and pull over SSH

## About this doc

How WordPress Studio pushes to and pulls from a WordPress site on any server the user reaches over SSH, so developers whose sites aren't on WordPress.com or Pressable get the same local-to-production workflow.

## Approach

SSH is a sites provider, `ssh`, next to `wpcom` and `spacefast` (`packages/providers/ssh/`). The publish panel, `studio push` and `studio pull`, the agent's `site_push`, `site_pull` and `site_connected_remote_sites` tools, and the hosts' remote-site routes already work with any provider, so SSH reaches all of them with no code of its own outside the provider. Nothing runs a second implementation of push or pull: `studio push|pull --remote-site ssh:<site>` runs the same commands, with the same activity reports, cancelling and Tracks.

Both directions move the archive Studio already uses (`sync.md`, Backup format): `sql/` and `wp-content/`. A push sends the archive the exporter makes for WordPress.com. A pull receives the same layout and imports it with the importer the Jetpack Backup pull uses. Neither side needs rsync, and Studio needs no `tar` binary: Node writes and reads archives locally, and the server uses its own `tar`.

Studio runs the user's `ssh`, so their keys, `ssh-agent`, `~/.ssh/config` aliases, `ProxyJump` and `known_hosts` behave as in their terminal. Studio stores no password or key.

## Requirements on the server

- A POSIX shell and PHP, with its `phar` extension. Windows servers are out of scope.
- Nothing else: Studio brings its own WP-CLI, and uses `tar`, `gzip` and the MySQL or MariaDB client when the server has them (Server tools, below).
- Key-based authentication that works without a prompt: an unencrypted key, or a key loaded in `ssh-agent` (on macOS, the keychain).
- A single site: multisite is refused when connecting.

## Connections

A connection is stored like any other, on the local site's record (`packages/common/lib/remote-sites.ts`, through `updateConfig`):

```jsonc
{
	"provider": "ssh",
	"site": {
		"id": "deploy@acme.com:/srv/www/acme/current", // the address; `--remote-site ssh:<id>`
		"name": "Acme",                   // blogname, read when connecting
		"url": "https://acme.com",        // home, read when connecting
		"php": "/opt/plesk/php/8.3/bin/php", // only when not `php`
		"contentDir": "/srv/www/acme/current/wp-content" // WP_CONTENT_DIR
	},
	"lastPushTimestamp": null,
	"lastPullTimestamp": "2026-11-22T10:00:00.000Z"
}
```

`site` is a loose record and `provider` a string, so there is no `CONFIG_VERSION` bump. Builds without the provider ignore the connection, as every reader filters by provider.

The id is the address in one form (`formatSshAddress`): `user@host:/path`, or `ssh://user@host:port/path` for another port. The host may be an alias from `~/.ssh/config`, and the path may be relative to the login directory, such as `public_html`. Connecting the same address again updates the same connection.

## Provider API

What SSH needs of the provider API, none of it specific to SSH:

- **A provider without an account.** A provider whose config is `undefined` has no `account`: there is nothing to connect, and surfaces treat it as connected. Settings and `/connect` leave it out. Publish opens on it only when it was the last provider used.
- **`sites.connect`**: how the user connects a site that isn't listed from an account, as a form schema like an account's form method. The CLI asks for its fields; the apps show the provider's own form, the `ConnectForm` of `getProviderUi( 'ssh' )`, which may run the services' `action( config, name, input )` on the computer, such as listing the user's SSH hosts. `SitesServices.resolve( config, { input } )` reaches the site and returns it (`resolveRemoteSite` in `@studio/common` and `Connector`), as `resolve( config, { id } )` does for `--remote-site ssh:<id>`, and connecting it is the same as connecting a listed site. SSH's form is `hostOnly`, so surfaces without `capabilities.localMachine` (Studio Cloud) leave SSH out. `newSite` is optional: a provider without it only connects existing sites.
- **`SitesServices.pullArchive( config, site, options, archive, onProgress, signal )`**: writes the site, as a tar of the backup format, to a `WritableStream`. It is the pull of a provider that sends the site rather than a backup to download.
- **`SitesServices.push`** gets the connected site as Studio stored it, not only its id and name.

The package's surface entries use no Node APIs; its services may, so `ssh/shell.ts` runs `ssh`.

## Files

| File | Contents |
|---|---|
| `ssh/address.ts` | Parsing and formatting addresses and hosts, checking the PHP command, and the schema of a host to add. Browser-safe: the connect form validates with it. |
| `ssh/descriptor.ts` | `SshSite`, and the provider: the connect form's fields (host, WordPress folder, PHP command), `pull`, `selective`, the intro, and the details and admin link shown for a connected site. |
| `ssh/connect-form.tsx` | The form the apps show (`ssh/ui.tsx`, read through `getProviderUi`): a host from the user's SSH config, or one they add, then the folder and PHP command. |
| `ssh/ssh-config.ts` | The hosts of the user's SSH config (`Host` lines, following `Include`), described with `ssh -G`, and adding one to `~/.ssh/studio_config`. |
| `ssh/shell.ts` | `shellQuote`, the run folder on the server (`syncFolder`), `uploadWpCli` and `inSite`, which put Studio's WP-CLI on the server and run it, `runSsh`, which spawns `ssh`, streams stdin or stdout, and turns its failures into messages that say what to fix, and `withSsh`, which shares one connection between the steps of an operation. |
| `ssh/fallbacks.ts` | The PHP that stands in for `mysqldump`, `mysql`, `tar` and `gzip` on a server without them. |
| `ssh/sites.ts` | `resolve`, which reads the site with one `wp eval`; `list` returns none, since the connections are the list; and the form's actions, `hosts` and `addHost`. |
| `ssh/push.ts`, `ssh/pull.ts` | The remote steps, each a POSIX shell script run by one `ssh` call. |

## SSH invocation

`ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=8 -o LogLevel=ERROR -o RequestTTY=no -o RemoteCommand=none -o ClearAllForwardings=yes [-C] [-p <port>] -- <destination> <script>`

- A push, pull or connection signs in once: a master connection (`ControlMaster`) starts with `true` and goes to the background, the steps share it, and `ssh -O exit` closes it at the end. `ControlPersist=300` closes one a crash left behind. Moving an archive, or WP-CLI, takes a connection of its own, as one shared with other commands slows it to a crawl. Windows' OpenSSH can't share a connection, so there each step connects.
- `BatchMode` fails at once on a key ssh can't use, rather than waiting on a prompt nobody sees.
- A new host key is trusted only while connecting, which the user starts by typing the host (`accept-new`). Every later step requires the known key, so a changed key fails, with the `ssh-keygen -R` command that clears it.
- `-C` compresses the pull's uncompressed tar on the wire.
- Windows 10 1809+ and 11 include the OpenSSH client. When `ssh` isn't on the app's `PATH`, Studio uses `%SystemRoot%\System32\OpenSSH\ssh.exe`.

## Server tools

Studio runs its own WP-CLI on every server, the one the CLI bundles (`wp-files/wp-cli/wp-cli.phar`), so every server runs the same version, whatever its host installed. Each Studio process names it in `STUDIO_WP_CLI_PHAR` at startup: the CLI, which also runs `studio ui`'s server, and the Desktop main process, which connects sites. Before the first step of a push, pull or connection, `uploadWpCli` checks that the server has PHP, and streams the phar to `~/.studio-sync/wp-cli-<hash>.phar` unless it's there, removing the ones older Studio versions put there. Scripts run it as `studio_wp`: `php`, or the PHP command set when connecting, then the phar, with `--allow-root` when the server's user is root.

The other tools fall back to PHP, run through that WP-CLI (`fallbacks.ts`): without `mysqldump` or the `mysql` client, tables are exported and imported over WordPress's own database connection, one statement at a time; without `tar` or `gzip`, PHP unpacks the push's archive and writes the pull's tar, with PAX headers for long names. The pull's tar goes to file descriptor 3, so a PHP warning can't end up in it. The pre-push backup stays uncompressed without `gzip`.

## Push

`apps/cli/commands/push.ts` exports the same archive as for WordPress.com. That archive leaves out users, `.deployignore` paths and the SQLite drop-in, and strips Studio's own `wp-config.php` constants. The provider then reports the usual push phases:

1. **Uploading**: the archive streams to `~/.studio-sync/push-<time>/`, with progress. The folder falls back to `$TMPDIR` when the site's folder contains the home folder, so the web server never serves it. The last three runs stay. Cancelling is possible only here, as for every push.
2. **Backing up**: unpacks the archive and exports, gzipped into the run folder when the server has `gzip`, the live tables the push replaces.
3. **Applying**:
   - Imports each table under the staging prefix `studio_new_`, after dropping any a failed push left. The SQLite export starts each statement on its own line and escapes newlines in values, so `sed` can rename tables by the start of the line.
   - Replaces the local URL with the server's home on the staging tables only, in plain, URL-encoded and JSON-escaped forms, with `wp search-replace --all-tables --skip-columns=guid`.
   - Keeps the server's own `home`, `siteurl`, `blog_public` and Jetpack connection options (`jetpack_options`, `jetpack_private_options`), as WordPress.com pushes do, and renames the roles option to the server's table prefix.
   - Replaces each pushed plugin and theme folder whole: it moves next to the live one, then two renames swap them, and the old one goes into the run folder. Uploads and other content merge, and nothing on the server is deleted. `wp-config.php` and the caching drop-ins (`advanced-cache.php`, `object-cache.php`) are never touched, as on WordPress.com.
   - Swaps in every staging table with one `RENAME TABLE` and drops the tables they replaced. A failure before the swap leaves the live database as it was.
4. **Finishing**: `wp cache flush`, then removes the unpacked copy.

## Pull

`pull-archive.ts` is the archive engine of `studio pull`. It runs for WordPress.com's Jetpack Backup unless Reprint is on, and for any provider with `pullArchive`. Site loading, the selection, the import, activity, Tracks and remembering the connection are shared; only fetching the archive differs. A full pull starts the site, running or not, before it records the version Studio compares local changes against, so what the first start writes (the Studio admin user, the SQLite driver's schema) doesn't count as a change.

On the server, a first call exports the site's own tables (`--all-tables-with-prefix`) and lists what was picked, in a folder where `wp-content` links to the site's content folder (a Bedrock `app` folder arrives as `wp-content`). It also measures the selection for progress. A second call streams it as an uncompressed tar, leaving out caches, backup-plugin folders, logs and the MySQL-bound drop-ins (`db.php`, `object-cache.php`, `advanced-cache.php`), then removes the folder, also when cancelled.

Locally, the importer points `wp-config.php` at the imported tables' prefix, the shortest prefix of a table named `…options`, so a backup or `.sql` file whose tables aren't prefixed `wp_` imports too.

Selection: `--options` (`sqls`, `uploads`, `plugins`, `themes`, `contents`) and `--only <wp-content paths>`. The pull dialog offers the entire site, files only, or content and settings only; individual files need backups to browse, which SSH sites don't have.

## CLI

```bash
studio pull --path ~/Studio/acme --remote-site 'ssh:deploy@acme.com:/srv/www/acme/current'
studio push --path ~/Studio/acme --remote-site ssh:acme.com --options plugins,themes
```

`--remote-site ssh:<site>` matches a connected site by its address, URL or host, or else connects the address given. In a terminal without a site, push asks for the address with the provider's form.

## UI

In Publish, SSH is a destination. Choosing it offers "Connect a site", which opens the provider's own form (`getProviderUi( 'ssh' ).ConnectForm`, so `apps/ui` has no SSH code); "Choose an existing site" offers the same form as "Connect to SSH", next to the other providers. On success the site is the destination, with "Update…" (push, with the usual selection) and "Pull from live site…".

In Add site, Connect lists every provider that pulls (`sites.pull`), WordPress.com and SSH, behind a switch. SSH shows the same form; once the server answers, setup proposes the site's name, and creating the site connects it and pulls it in the background, as for a WordPress.com site.

The form picks a host from the user's SSH config: Studio lists the `Host` names of `~/.ssh/config` and the files it includes, without patterns, and `ssh -G` says who and where each connects as. "Add SSH host…" asks for a name, the user and server, a port and a key, writes the host to `~/.ssh/studio_config`, puts `Include ~/.ssh/studio_config` first in `~/.ssh/config` once, and keeps it only when `ssh` reaches the server with it, so the host works from the user's terminal too and Studio stores no connection details. The form reaches these through `Connector.runSitesAction` (`SitesServices.action`), which runs one of the provider's actions on the computer.

The form's values go to `Connector.resolveRemoteSite`, which reaches the server before Studio creates or changes anything; `connectRemoteSite` then saves the site it returned. Both run in `@studio/common`, from the main process and from `studio ui`'s server (`POST /remote-sites/:provider/resolve`, and `POST /remote-sites/:provider/actions/:action` for the form's actions). No server version gate is needed: the `local` connector meets older servers only on Studio Cloud, which doesn't offer SSH.

## Security

- No password, passphrase or key is stored or typed into Studio.
- Host keys are checked against the user's `known_hosts`, and a changed key always fails.
- The destination is validated and follows `--`. The `-o` options are fixed, every value in a remote script goes through `shellQuote`, and the PHP command may only contain path characters.
- Dumps and archives on the server are created with `umask 077`, outside the document root.
- A push never sends users or the SQLite drop-in, and a pull never brings MySQL drop-ins.

## Follow-ups

- Send only changed files on repeat transfers: compare a remote `find` listing with the local tree, and still send a tar, so it works on Windows.
- Browse remote files for a selective pull.
- Restore a pre-push backup from Studio.
- Multisite.
