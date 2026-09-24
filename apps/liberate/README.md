# liberate.sh

Paste a website's address and get it back as a WordPress site you can host anywhere. liberate.sh hands the address to the Studio CLI (`studio site create --from <url>`), which captures the site with [Data Liberation](https://github.com/Automattic/data-liberation-agent) — a real browser walking every page it can find — and rebuilds the capture as WordPress with the Static Site Importer. What comes back is `<host>-wordpress.zip`: a Studio/Jetpack-format backup with the database and `wp-content`, including a theme that carries the original site's look. It opens in [Studio](https://developer.wordpress.com/studio/), which can push it to WordPress.com or Pressable, and restores on any host.

## How a job runs

1. `POST /api/jobs` validates the address (public `http(s)` host on a default port, resolving only to public IPs), then queues a job.
2. The worker runs `studio site create --from <url>`, spawned with an IPC channel so the CLI reports progress as messages instead of drawing spinners. Those messages drive the four steps on the page — scan, copy, rebuild, zip — and stream to it over SSE (`/api/jobs/:id/events`).
3. The site's temporary local address is replaced with the original one, and `studio export` writes the zip.
4. The Studio site is stopped and forgotten, the working files are deleted, and the zip is served until it expires.

The importer checks its own work and can reject an import that came out incomplete. When that happens but the site was created anyway, the job still hands over the zip, with a line saying parts of the site didn't convert cleanly: a site with gaps beats no site at all.

Studio state (config, sites, daemon) lives under the data directory, isolated from any Studio install on the same machine.

## Running it locally

```bash
# Simulated jobs: no crawling, no Studio needed. Hosts containing "fail" fail.
LIBERATE_FAKE_PIPELINE=1 npm run dev -w @studio/liberate

# The real pipeline, against the CLI built from this repository.
npm run cli:build
STUDIO_CLI="$PWD/apps/cli/dist/cli/main.mjs" npm run dev -w @studio/liberate
```

Then open http://localhost:8080. In development the server runs Vite as middleware. `npm run build -w @studio/liberate` followed by `npm start -w @studio/liberate` runs the production build.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `8080` | |
| `LIBERATE_DATA_DIR` | `$RAILWAY_VOLUME_MOUNT_PATH`, else `apps/liberate/.data` (`.data/simulated` for simulated jobs) | Jobs, downloads and Studio state. Must be persistent. |
| `STUDIO_CLI` | `studio` | The Studio CLI: a command on `PATH`, or the path to its entry point. |
| `LIBERATE_CONCURRENCY` | `1` | Jobs running at once. Each needs a headless Chromium and a WordPress instance. |
| `LIBERATE_MAX_QUEUED` | `20` | New jobs are refused beyond this. |
| `LIBERATE_TIMEOUT_MINUTES` | `60` | Per job. |
| `LIBERATE_RETENTION_HOURS` | `24` | How long downloads are kept. |
| `LIBERATE_JOBS_PER_HOUR` | `3` | Per IP. Visitors also get one active job at a time. |
| `LIBERATE_MIN_FREE_DISK_GB` | `1` | New jobs are refused below this. A big site can need several GB while it runs. |
| `LIBERATE_TRUST_PROXY` | `1` | Proxy hops in front of the app, for client IPs. |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | unset | Set both to require a [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) check. |

## Deploying on Railway

1. Create a service from this repository. Leave **Root Directory** empty, because the image is built from the repository root. Set **Railway Config File** to `/apps/liberate/railway.json`: it selects the Dockerfile, the health check and the watch paths.
2. Attach a volume. Its mount path is picked up through `RAILWAY_VOLUME_MOUNT_PATH`.
3. Give the service room: headless Chromium and WordPress want at least 2 vCPUs and 4 GB of memory.
4. Keep the service in its own project, with no other services on its private network. The crawler visits arbitrary sites.
5. Optionally set the Turnstile keys and any of the limits above.

Keep one replica: jobs and downloads live on the volume.

The image builds the Studio CLI from this repository instead of installing it from npm, so the service always runs the same code as the branch it was deployed from, and bundles WordPress, WP-CLI and PHP so the first job doesn't wait for a download.

## Abuse protection

- Addresses must be public: no credentials, no custom ports, no private or reserved IPs, checked after DNS resolution.
- The Studio CLI and the capture run with an egress guard (`src/server/network.mjs`, preloaded through `NODE_OPTIONS`). In those processes, any hostname that resolves to a private address fails to resolve, whichever code makes the request.
- Per-IP rate limits, one active job per visitor, a queue cap, a per-job timeout that kills the whole process group, a free-disk check, and optional Turnstile.
- Job IDs are random 128-bit values. Knowing one is the only way to reach a job and its downloads, and everything is deleted after the retention period.
- Visitors confirm they own the site or have permission to copy it.

## Known limitations

- Fidelity is whatever the capture and the Static Site Importer manage on their own: no AI is involved, and complex layouts come back imperfect.
- The zip is in Studio's backup format. Hosts without a Studio or Jetpack import path need a manual restore (upload `wp-content`, import the SQL dump).
