# liberate.sh

Paste a website's address and get it back as a WordPress site you can host anywhere. liberate.sh asks WordPress.com to copy the site — `POST /wpcom/v2/static-site-import-preview`, which captures it with [Data Liberation](https://github.com/Automattic/data-liberation-agent) and rebuilds it as WordPress with the Static Site Importer — then hands the visitor the archive as `<host>-wordpress.zip`: the site's `wp-content` and an SQLite database, including a theme that carries the original look. It opens in [Studio](https://developer.wordpress.com/studio/), which can push it to WordPress.com or Pressable. Hosts running the SQLite integration take it as it is; anywhere else, Studio is the way in.

The server copies nothing and stores nothing heavy: no browser, no PHP, no WordPress, no archives on disk. A capture session at WordPress.com *is* the job — it has the state, the progress, the concurrency limits and the archive — so this app validates the address, starts a session, reads it back for the page, and sends the visitor to the signed download.

## How a job runs

1. `POST /api/jobs` validates the address (public `http(s)` host on a default port, resolving only to public IPs), reads the source page's `<title>` for the headline, then mints an app token (OAuth2 `client_credentials`, scope `static-site-import-preview`, 15 minutes, no user or blog behind it) and creates a capture session. The session's id becomes the job's id.
2. The page polls `GET /api/jobs/:id`. Each read is one call to the session, mapped onto the four steps — scan, copy, rebuild, zip — from its `state` and `progress`.
3. `GET /api/jobs/:id/files/site` reads the session once more and redirects to its signed `archive_url`, which is minted fresh on every click.

All this app keeps is a few hundred bytes per job: the address, the host, the site's name and when the link expires. The session reports a digest of the source rather than its address, so without that record a bookmarked link could not say which site it belonged to. Everything else — the capture, its progress, the three-day archive, the concurrency and daily limits — belongs to WordPress.com, which is the only thing that can enforce them anyway.

That record goes through a small `JobStore` interface (`src/server/store.ts`): one file per job on Railway, and a table wherever there is no disk, without the rest of the app noticing.

A finished capture keeps holding one of the app's three slots until it is revoked or expires, and revoking it takes the visitor's download with it. So nothing is revoked while a link is alive: when WordPress.com reports every slot busy, the oldest capture that has already finished is released to make room, and the hourly prune releases whatever has outlived its record. A download can therefore disappear before its three days are up, but only when new visitors need the capacity.

The importer records its own verdict (`preview_summary.quality_pass`, and the comparison's `fidelity.pass`) instead of refusing a copy that came out badly. When either says no, the download is still handed over, with a line saying some pages may be missing pieces: a site with gaps beats no site.

## The registered app

liberate.sh is client **149292** in WordPress.com's reviewed policy registry (`wpcom_static_site_import_preview_apps()`), with its own role-less machine owner. Its budget is **25 new captures a day and three at once**; retrying the same URL is deduplicated and costs nothing. Over budget, the API answers `static_site_import_preview_daily_limit`, `..._busy` or `static_site_import_session_limit_exceeded`, and liberate.sh asks the visitor to come back later.

The app secret is issued by the WordPress.com side and lives only in this service's environment. See `wp-content/lib/imports/static-site/app-access.md` in the wpcom repository for the contract.

## Running it locally

```bash
# Simulated jobs: no WordPress.com, no credentials. Hosts containing "fail" fail.
LIBERATE_FAKE_PIPELINE=1 npm run dev -w @studio/liberate

# The real API, with the app credentials.
WPCOM_CLIENT_ID=149292 WPCOM_CLIENT_SECRET=… npm run dev -w @studio/liberate
```

Then open http://localhost:8080. In development the server runs Vite as middleware. `npm run build -w @studio/liberate` followed by `npm start -w @studio/liberate` runs the production build.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `8080` | |
| `WPCOM_CLIENT_ID`, `WPCOM_CLIENT_SECRET` | unset | The registered app. Required unless jobs are simulated. |
| `WPCOM_API_BASE` | `https://public-api.wordpress.com` | For a sandbox. |
| `LIBERATE_DATA_DIR` | `$RAILWAY_VOLUME_MOUNT_PATH`, else `apps/liberate/.data` (`.data/simulated` for simulated jobs) | The small per-job records. Must be persistent. |
| `LIBERATE_RETENTION_HOURS` | `72` | How long a job's link keeps working. WordPress.com holds a ready archive for about three days. |
| `LIBERATE_JOBS_PER_HOUR` | `3` | Per IP. Visitors also get one active job at a time. |
| `LIBERATE_TRUST_PROXY` | `1` | Proxy hops in front of the app, for client IPs. |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | unset | Set both to require a [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) check. |

## Deploying on Railway

1. Create a service from this repository. Leave **Root Directory** empty, because the image is built from the repository root. Set **Railway Config File** to `/apps/liberate/railway.json`: it selects the Dockerfile, the health check and the watch paths.
2. Attach a volume. Its mount path is picked up through `RAILWAY_VOLUME_MOUNT_PATH`.
3. Set `WPCOM_CLIENT_ID` and `WPCOM_CLIENT_SECRET`.
4. Optionally set the Turnstile keys and any of the limits above.

Keep one replica: jobs and downloads live on the volume.

## Abuse protection

- Addresses must be public: no credentials, no custom ports, no private or reserved IPs, checked after DNS resolution. WordPress.com validates the address again on its side.
- The only request this server makes to a visitor's site is the one that reads its title. It follows at most three redirects and re-checks each hop against the same public-address rules.
- Per-IP rate limits and optional Turnstile, which exist to keep the app's daily budget for real visitors.
- A job's id is its WordPress.com session id, 128 random bits. Knowing one is the only way to reach a job or its download.
- Visitors confirm they own the site or have permission to copy it.
- The app token carries one scope and no WordPress.com user or blog permissions, so a compromised server cannot touch anyone's site.

## Known limitations

- Fidelity is whatever the capture and the Static Site Importer manage on their own: no AI is involved, and complex layouts come back imperfect.
- A liberated site is large, mostly media and the WordPress install itself.
- The archive is a Playground-shaped site folder, not a SQL dump, so a host without SQLite support needs Studio in between.
- Twenty-five captures a day is the whole service's ceiling until the registered budget is raised.
