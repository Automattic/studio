# liberate.sh

Paste a website's address and get it back as a WordPress site you can host anywhere. liberate.sh asks WordPress.com to copy the site — `POST /wpcom/v2/static-site-import-preview`, which captures it with [Data Liberation](https://github.com/Automattic/data-liberation-agent) and rebuilds it as WordPress with the Static Site Importer — then hands the visitor the archive as `<host>-wordpress.zip`. It opens in [Studio](https://developer.wordpress.com/studio/), which can push it to WordPress.com or Pressable, and restores on any host.

The server copies nothing itself: no browser, no PHP, no WordPress. It validates the address, queues the request, follows the capture and serves the archive.

## How a job runs

1. `POST /api/jobs` validates the address (public `http(s)` host on a default port, resolving only to public IPs), then queues a job.
2. The worker reads the source page's `<title>` for the headline — WordPress.com reports only bounded counts about a capture, never the site's own text — then mints an app token (OAuth2 `client_credentials`, scope `static-site-import-preview`, 15 minutes, no user or blog behind it) and creates a preview session for the URL.
3. It polls the session until `preview_ready`, mapping its states onto the four steps on the page — scan, copy, rebuild, zip — which stream to it over SSE (`/api/jobs/:id/events`).
4. The archive is downloaded from the session's signed `archive_url`, checked against its `archive_hash`, and kept until it expires. The session is then revoked, which gives the app's slot back.

The importer records its own verdict (`preview_summary.quality_pass`, and the comparison's `fidelity.pass`) instead of refusing a copy that came out badly. When either says no, the download is still handed over, with a line saying some pages may be missing pieces: a site with gaps beats no site.

Storing our own copy is deliberate: WordPress.com expires ready artifacts after three days and its signed URLs sooner, while a visitor's link here keeps working for as long as this app says it does.

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
| `LIBERATE_DATA_DIR` | `$RAILWAY_VOLUME_MOUNT_PATH`, else `apps/liberate/.data` (`.data/simulated` for simulated jobs) | Job records and downloads. Must be persistent. |
| `LIBERATE_CONCURRENCY` | `1` | Jobs running at once. The app's own limit is three captures. |
| `LIBERATE_MAX_QUEUED` | `20` | New jobs are refused beyond this. |
| `LIBERATE_TIMEOUT_MINUTES` | `80` | Per job. WordPress.com gives a capture about 75 minutes before it times out. |
| `LIBERATE_POLL_SECONDS` | `5` | How often a running capture is polled. |
| `LIBERATE_RETENTION_HOURS` | `24` | How long downloads are kept. |
| `LIBERATE_JOBS_PER_HOUR` | `3` | Per IP. Visitors also get one active job at a time. |
| `LIBERATE_MIN_FREE_DISK_GB` | `1` | New jobs are refused below this. |
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
- Per-IP rate limits, one active job per visitor, a queue cap, a per-job timeout, a free-disk check, and optional Turnstile — all of which exist to keep the app's daily budget for real visitors.
- Job IDs are random 128-bit values. Knowing one is the only way to reach a job and its downloads, and everything is deleted after the retention period.
- Visitors confirm they own the site or have permission to copy it.
- The app token carries one scope and no WordPress.com user or blog permissions, so a compromised server cannot touch anyone's site.

## Known limitations

- Fidelity is whatever the capture and the Static Site Importer manage on their own: no AI is involved, and complex layouts come back imperfect.
- A liberated site is large, mostly media and the WordPress install itself.
- Twenty-five captures a day is the whole service's ceiling until the registered budget is raised.
