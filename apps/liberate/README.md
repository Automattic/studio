# liberate.sh

Paste a website's address and get it back as a WordPress site you can host anywhere. liberate.sh crawls the site with [data-liberation](../../packages/data-liberation-agent) (Wix, Squarespace, Shopify, Webflow, GoDaddy, Weebly, HubSpot, Hostinger, and a generic fallback for everything else), rebuilds it as a WordPress site with the Studio CLI, and offers two downloads:

- **The full site** (`<host>-wordpress.zip`): a Studio/Jetpack-format backup with the database and `wp-content`, including a theme that carries the original site's look. It opens in [Studio](https://developer.wordpress.com/studio/), which can push it to WordPress.com or Pressable, and restores on any host.
- **The content** (`<host>-content.zip`): a WXR export (`content.xml`), the media, redirects and a WooCommerce product CSV, for Tools › Import › WordPress on any site, free WordPress.com sites included.

## How a job runs

1. `POST /api/jobs` validates the address (public `http(s)` host on a default port, resolving only to public IPs), then queues a job.
2. The worker runs `data-liberation <url> --non-interactive --no-agent --limit <max pages>`. That's the deterministic path: no AI, with the look captured from the site's own CSS. It creates a Studio site and imports everything into it. Progress comes from data-liberation's `watch.log` and streams to the page over SSE (`/api/jobs/:id/events`).
3. The site's temporary local address is replaced with the original one, `studio export` writes the full-site zip, and the content zip is packed next to it.
4. The Studio site is stopped and forgotten, the working files are deleted, and the zips are served until they expire.

Studio state (config, sites, daemon) lives under the data directory, isolated from any Studio install on the same machine.

## Running it locally

```bash
# Simulated jobs: no crawling, no Studio needed. Hosts containing "fail" fail.
LIBERATE_FAKE_PIPELINE=1 npm run dev -w @studio/liberate

# The real pipeline: needs the `studio` CLI on your PATH and Playwright's Chromium.
npx playwright install chromium
npm run dev -w @studio/liberate
```

Then open http://localhost:8080. In development the server runs Vite as middleware. `npm run build -w @studio/liberate` followed by `npm start -w @studio/liberate` runs the production build.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `8080` | |
| `LIBERATE_DATA_DIR` | `$RAILWAY_VOLUME_MOUNT_PATH`, else `apps/liberate/.data` (`.data/simulated` for simulated jobs) | Jobs, downloads and Studio state. Must be persistent. |
| `LIBERATE_MAX_PAGES` | `100` | URLs crawled per site. Bigger sites are cut off, and the result says so. |
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
3. Give the service room: headless Chromium and PHP-WASM want at least 2 vCPUs and 4 GB of memory.
4. Keep the service in its own project, with no other services on its private network. The crawler visits arbitrary sites.
5. Optionally set the Turnstile keys and any of the limits above.

Keep one replica: jobs and downloads live on the volume.

## Abuse protection

- Addresses must be public: no credentials, no custom ports, no private or reserved IPs, checked after DNS resolution.
- data-liberation and the Studio CLI run with an egress guard (`src/server/network.mjs`, preloaded through `NODE_OPTIONS`). In those processes, any hostname that resolves to a private address fails to resolve, whichever code makes the request.
- Per-IP rate limits, one active job per visitor, a queue cap, a per-job timeout that kills the whole process group, a free-disk check, and optional Turnstile.
- Job IDs are random 128-bit values. Knowing one is the only way to reach a job and its downloads, and everything is deleted after the retention period.
- Visitors confirm they own the site or have permission to copy it.

## Known limitations

- Output quality is data-liberation's `--no-agent` output: content plus the carried-over CSS. The AI-driven replica (`/liberate` in Claude Code) is more faithful, but isn't wired in.
- The full-site zip is in Studio's backup format. Hosts without a Studio or Jetpack import path need a manual restore (upload `wp-content`, import the SQL dump).
