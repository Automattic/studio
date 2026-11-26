# Studio config

`~/.studio/config.json` (or `$DEV_CONFIG_DIR/config.json`) is the one config file every Studio app reads and writes: the Desktop app, `studio ui`, the CLI and `studio mcp`. Session transcripts stay in `~/.studio/sessions/`, and `~/.studio/mu-plugins/settings.json` is a copy of the few preferences PHP reads (`../mu-plugin-settings.ts`).

## Reading and writing

- `readConfig()` reads it without a lock.
- `updateConfig( ( config ) => { … } )` takes the lock, reads the file, runs the callback on it and writes back the sections the callback changed. Every Studio process waits on that lock, so keep the callback short and make no network requests in it. It can't call `updateConfig` again.
- `readConfigSync()` is only for reads that must be synchronous, such as Sentry's user at boot.

Nothing else writes the file.

## Sections

Each top-level key is a section with its own schema (`schema.ts`), parsed on its own. A section that doesn't parse is reported to Sentry and reads as empty, and it stays on disk as it was unless a write changes it. In `sites` and `snapshots`, an entry that doesn't parse is left out of what callers read and written back as it was.

| Section | Holds |
|---|---|
| `install` | This install's anonymous ids: Tracks, Sentry, provider sign-ins |
| `providers` | The selected AI provider, each provider's config (the WordPress.com one is the Studio sign-in) |
| `preferences` | The user's settings, onboarding state, selected skills |
| `sites` | Each local site, with Studio's settings for it and the remote sites it syncs with (`connections`) |
| `snapshots` | Preview metadata and local site associations. Transfer versions and times live on the corresponding site connection. |
| `sessions` | Studio Code sessions' titles, archived and unread state, and site |
| `stats` | When each aggregated stat was last bumped |
| `desktop`, `cli` | State only that app reads |

## Changing the shape

Sections are loose: a build that rewrites a section keeps the fields a newer build added. Adding an optional field therefore needs nothing more.

Anything that changes existing data (renaming, moving or retyping a field) bumps `CONFIG_VERSION` in `schema.ts` and adds a step to `migrations.ts`. A step is a pure function from the previous version's file to the next one's. Every surface runs the steps on its first read, under the lock, so the CLI and the Desktop app migrate the same way whichever is updated first. A build that finds a newer version refuses it with `ConfigTooNewError`, which each surface turns into an "update Studio" message.

## Older builds

A missing `config.json` is built from what earlier builds kept (`legacy-import.ts`): `shared.json`, `cli.json` and `app.json`, or the `appdata-v1.json` of builds before 1.7.7. Every change the old per-app migrations made is applied on the way, so an install of any version upgrades in one step. The three files are copied to `~/.studio/legacy-config/` and replaced with `{ "version": 2, "movedTo": "config.json" }`, which older builds reject with their own version error instead of starting with no sites. If `config.json` is lost later, the import reads those copies again.

Housekeeping on other files earlier builds left behind (old certificates, server files, the `pm2` folder) is in `../startup-tasks.ts`.
