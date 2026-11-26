# `studio serve` and hosted Studio

## About this doc

`studio serve` runs Studio on a machine someone else reaches over the network: the Studio API, the events stream, agent runs and the sites, for a Studio UI served from somewhere else. Studio Cloud runs one per user on a machine we host, and reaches it from a UI served centrally. This doc covers what Studio itself provides for that; the hosted service (accounts, machines, plans) lives in its own repository.

It builds on [studio-apps-and-surfaces.md](./studio-apps-and-surfaces.md) (one product, several surfaces).

## `studio serve`

`studio ui` without the UI (`apps/cli/commands/serve.ts`). It starts the same `apps/local` server, without serving `apps/ui`, and is hidden from `studio --help` until Studio Cloud launches. Its host configures it through the environment:

| Variable | What |
| --- | --- |
| `STUDIO_SERVE_SECRET` | Signs the sessions this server accepts. Required off loopback. |
| `STUDIO_SERVE_MACHINE_ID` | The audience of those sessions, so a token for one server doesn't open another. |
| `STUDIO_SERVE_ALLOWED_ORIGINS` | Origins of the UI, allowed to call the API with credentials and to frame the sites. |
| `STUDIO_CLOUD_DOMAIN` | Serves the API at `<machine>.<domain>` and each site at `<site>--<machine>.<domain>`. |
| `STUDIO_MAX_SITES`, `STUDIO_MAX_RUNNING_SITES`, `STUDIO_MAX_STORAGE_GB` | Limits the host sets, for example per plan. |

### Who gets in

Every request goes through the gate (`apps/cli/lib/serve-gate.ts`):

- **The API** takes a session signed with the server's secret (`packages/common/lib/signed-token.ts`, HS256 over Web Crypto), as a bearer token or as the HTTP-only cookie `POST /api/cloud/login` sets from one. Cookies, because `EventSource` can't send headers.
- **Sites are private.** A request from outside reaches a site only with a site-access cookie, which the API host hands a signed-in user through a one-minute link (`/api/cloud/site-access`); a page without one is sent there, anything else gets 401. Sharing a site goes through preview sites. The gate lets the UI's origins frame wp-admin and phpMyAdmin, and marks sites' redirects `no-store`.
- **Requests from the machine itself** (WordPress calling itself, the agent's browser and shell) arrive over loopback and are trusted.

### Sites at public addresses

With `STUDIO_SITE_URL_TEMPLATE`, set by `studio serve`, the CLI gives each site its public address as `WP_HOME` (`apps/cli/lib/cli-config/sites.ts`) and starts its server there, so WordPress sees its real address and nothing rewrites URLs in responses. TLS ends in front of the machine; the existing mu-plugin honours `X-Forwarded-Proto`.

The machine reaches its own sites at those addresses without leaving it (`apps/cli/lib/serve-local-tls.ts`): `studio serve` points the sites' hosts at `127.0.0.1` and `::1` in `/etc/hosts`, answers HTTPS there with a certificate from the machine's own authority, and makes the processes it starts trust that authority: Node through `NODE_EXTRA_CA_CERTS`, OpenSSL and curl through `SSL_CERT_FILE` and `CURL_CA_BUNDLE`, PHP through a settings file in `PHP_INI_SCAN_DIR`, WordPress's HTTP API through a Studio mu-plugin (`STUDIO_CA_BUNDLE`), and Chromium by ignoring certificate errors on these pages.

### Limits

The CLI refuses a new site past `STUDIO_MAX_SITES` (`site create`), a site start past `STUDIO_MAX_RUNNING_SITES` (the process manager, whoever asks), and an import whose backup won't fit in what `STUDIO_MAX_STORAGE_GB` leaves (`apps/cli/lib/site-capacity.ts`). `GET /api/site-limits` reports them with the current counts, and the Usage tab shows them. Without them, Studio keeps its defaults: no site or storage limit and 36 running sites.

### WordPress.com and AI

`studio serve` signs in to WordPress.com as Studio does on a computer: the UI hands it the user's token (`POST /api/auth/login`) when the server isn't signed in as that user. The agent's model calls then go from the server to the WordPress.com AI proxy, billed to the user's AI credits, and push, pull and preview sites work as on Desktop.

### Telling the host it's busy

`GET /api/health` reports `busy` while an agent runs, so a host that suspends idle servers can wait out a build.

## The UI

The same `apps/ui` app, built with `build:cloud` (`main.cloud.tsx`, `index.cloud.html`), with the `local` connector given the server's origin and its `remote` option:

- **Requests** carry the server's cookie (`credentials: 'include'`, and `EventSource` with `withCredentials`).
- **Sign-in and sign-out** go to the host.
- **The events stream follows focus**, so a forgotten tab doesn't keep a server that sleeps when idle awake, and reopens, refetching what changed, when the page has focus again. The site list refreshes only while the window has focus, for the same reason.
- **Capabilities:** `localMachine` covers what needs the user's own computer, off for a remote server: opening a folder, editor or terminal, the site's path, custom domains, Xdebug. `loopbackSignIn` is off too: a provider sign-in that returns to a local port would return to the server.
- **Plans:** `getSiteLimits` and `getBilling` are optional connector methods that only a remote server's host provides, so the Plan, Receipts, Sites and storage sections of the Usage tab show only there.

`main.cloud.tsx` is Studio Cloud's entry: it signs in through the Studio Cloud service at `/cloud/*` on the page's own origin, shows the plan picker (`features/cloud`) until the user has a plan, then opens the workspace on their machine.

### One UI for every server version

**Decided:** the UI is served centrally, one build for everyone, and the connector supports older servers down to a minimum supported version that we raise from time to time.

- `studio serve` reports its Studio version at `GET /api/version`, which the connector reads in `init()`.
- The connector turns features on from that version through `ConnectorCapabilities`. Feature code never reads the server version, so an older server shows fewer controls, never broken ones.
- New response fields are optional in the connector's schemas, so an older server's responses still parse.
- The server never removes an endpoint or field the UI used until the minimum supported version has moved past the release that last needed it.
- Below the minimum (`MIN_SERVER_VERSION` in `connectors/local/server-version.ts`) the app doesn't start: it shows "Updating your workspace" and retries, while the host updates the server.

This rule applies to the `local` connector everywhere. The mobile app needs it anyway: app store builds lag behind and we don't choose which one is installed.
