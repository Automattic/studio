# Headless WordPress support in Studio: research and proposal

Status: proposal, 2026-10-31. Nothing in this document is implemented. Research notes behind it (five files, ~230 KB, every claim with a URL) are in the session scratchpad at `/private/tmp/claude-501/-Users-nickdiego-Developer-studio--claude-worktrees-headless-wordpress-research-7fd15c/c1297438-fd43-484e-a4ab-6490b3740f78/scratchpad/research_notes/Headless WordPress in Studio/`.

## 1. Summary

**Headless support is not new to Studio; it was prototyped, parked, and is now unblocked.** Riad Benguella opened [PR #3888 "Add headless WordPress site type (CLI-first)"](https://github.com/Automattic/studio/pull/3888) on 2026-06-18 and closed it on 2026-07-03 "to leave this idea for later". The [P2 discussion](https://studioapp2.wordpress.com/2026/06/18/opportunity-headless-wp-and-static-sites-in-studio/) did not reject the idea; it concluded that a local-only experiment cannot produce a real signal without "at least one deploy target wired end-to-end" (Marin Atanasov, Bernardo Cotrim). That deploy target now exists: Spacefast ships WordPress data sources, Next.js/Astro/Vite adapters and a WordPress rebuild plugin, and the Studio ⇄ Spacefast connector is a live draft ([PR #5567](https://github.com/Automattic/studio/pull/5567), [STU-2617](https://linear.app/a8c/issue/STU-2617)).

**Studio is already a usable headless backend with zero changes.** WordPress core reflects any `Origin` on REST responses and answers preflights, Application Passwords work over plain HTTP because Studio defaults `WP_ENVIRONMENT_TYPE` to `local`, and the native PHP router serves `/wp-json/` and `/graphql`. A Next.js app pointed at `http://localhost:8881` works today. What is missing is everything around it: starting and supervising the frontend process, wiring env vars and secrets, previews and revalidation, a place for the frontend in the UI, agent guidance, and a path to production.

**Recommendation.** Build "decoupled" headless support (WordPress as an API backend, a separate JavaScript frontend) as an opt-in site type, CLI and agent first, with Spacefast as the end-to-end deploy target. Keep the WordPress half of a headless site a normal Studio site so every existing operation (push, pull, export, previews, Blueprints) keeps working. Treat the frontend as a supervised sibling project with a dev command, a port and an env contract, not as a new kind of WordPress. Ship it as an experiment behind a flag, measure, and decide on deeper investment (managed Node runtime, production preview/revalidation parity) from the data.

**Constraint: no dependency on competitor-managed code.** Faust.js, the FaustWP plugin, WPGraphQL Content Blocks and the hwptoolkit plugins (`hwp-previews`, `wpgraphql-webhooks`, …) are WP Engine projects and are out of bounds as dependencies; they appear below only as competitive context. WPGraphQL itself, Smart Cache, the IDE and WPGraphQL for ACF live in the `wp-graphql` organization, are stewarded from Automattic, and are fine to build on. Where block data over the API is needed, VIP's Block Data API (Automattic) is the option, not Content Blocks.

This is distinct from the static-export work in #5567 (freeze WordPress's own rendered frontend with Simply Static). Both are "WordPress without a PHP frontend in production", both publish to Spacefast, but they serve different users. They should share the connector and nothing else.

## 2. Two things people mean by "headless"

| | Static export (in flight: #5567) | Decoupled / headless (this proposal) |
|---|---|---|
| Who renders pages | WordPress, at export time (theme, blocks) | A JS frontend (Next.js, Astro, plain HTML) from WordPress data |
| Editing experience | Full block editor, WYSIWYG | Block editor for content; design lives in frontend code |
| Why users want it | Cheap, fast, safe hosting of a normal WP site | "Let the model write any markup" (Tailwind, shadcn), app-like frontends, mobile/other clients |
| Production | Static files on Spacefast; no WordPress at runtime | WordPress hosted (WordPress.com, Pressable, VIP) + frontend on Spacefast/Vercel; or build-time bake with no WP in production |
| Dynamic features | Lost (forms, comments, search) | Frontend's responsibility; WP stays available at runtime |

Brian Coords's critique in the June thread applies to the left column ("the value of these is pretty unrelated to why vibe coders like static sites") and his list of WordPress assumptions that break (previews pointing at the wrong place, block editor not matching the frontend, plugins that do nothing) is the checklist for the right column. Marin's reply holds: most of those assumptions "are largely irrelevant when WordPress is purely the backend and never renders anything", and the remaining ones (preview routing, view links, CORS) are exactly what a local tool can automate.

## 3. Where we are (internal)

### 3.1 PR #3888, what it built and why it would need re-deriving

The prototype introduced one site shape with an invariant: the top-level `port`/`url` describe the frontend visitors see, and WordPress always runs as a backend on its own `wpPort`. On disk a headless site was a container with `wordpress/` and `frontend/`. A Node child (`frontend-server-child.ts`) served `frontend/public` and reverse-proxied `/wp-json`, `/wp-admin`, `/wp-content`, `/wp-login.php`, `/studio-auto-login` and `?rest_route=` requests to WordPress, so the browser saw one origin. `studio site create --headless` scaffolded a placeholder `index.html`; the agent got a "Headless sites" prompt section (build the frontend in `frontend/`, read `/wp-json`, don't scaffold a theme); `export`, `import`, `pull`, `push` and previews were refused for headless sites; the Desktop app hid them.

What worked: the process model (daemon-supervised child), the routing list, the agent integration, and the finding that the CLI could do this in ~750 lines. What did not: the container layout forced a `getWpPath()`/`getWpUrl()` seam through 45 files and disabled every site operation; there was only a static template and no dev-server or build step; no UI.

Since June the code has moved: the agent lives in `packages/agent` (tools, skills, `resolveStudioTools`, `host.ui` gating), the Playground runtime was removed and sites run on native PHP (`apps/cli/php-server-child.ts`), `apps/ui` is the single renderer for Desktop and `studio ui`, and CLI commands lazy-load. The PR is a design reference, not a rebase candidate.

### 3.2 The June discussion, distilled

- **Thesis (Riad):** WordPress share is going to "None" (hand-built and AI-built static sites on Vercel-class hosts). AI removed the "learn a framework" cost of headless; the DevOps glue is what remains, and that is something Automattic can sell. Follow-up on 2026-08-04: W3Techs August data confirms the trend, "the proposal here becomes more important to pursue."
- **Condition for a fair experiment (Marin, Bernardo, Riad):** one deploy target wired end-to-end, "a one-command deploy plus pull-back-to-edit, not just static docs."
- **Scope guidance (Marin, Pablo):** keep Studio lean on plain WordPress; agents model content with CPTs, taxonomies and meta over REST, so no modeling UI or SCF dependency is needed for the experiment. Headless means no frontend, not no admin.
- **Signals of demand (Jacob, VIP):** VIP has lost customers to Sanity and Contentful and still sees real decoupled demand, alongside some movement back to full-stack.
- **Adjacent ideas (Chris Huber):** with near-zero static hosting, WordPress need not be hosted at all; and a headless backend is a step toward native/mobile apps on WordPress via the Abilities API.
- **September follow-up (Brian Coords):** tested Studio → Simply Static → Spacefast; "a Spacefast integration could be a key part of Studio".

### 3.3 What shipped instead, and what it gives us

[PR #5567](https://github.com/Automattic/studio/pull/5567) (draft, 2026-10-29) adds `studio export-static` (Simply Static run against a database snapshot, never installed in the site), `studio spacefast login|logout|publish` (device-flow login, changed-files upload, versioned live channel), a Spacefast row under Settings → AI providers → Publishing, and a Spacefast tab in Share and publish. It spans CLI, `@studio/common` (`lib/spacefast/`, `sites/spacefast.ts`, `types/spacefast.ts`), Desktop IPC, `apps/local` and `apps/ui/features/spacefast/`. wordpress.studio is already published this way. For this proposal it supplies the connector, the login, the Space picker and the sync-activity progress plumbing.

### 3.4 Spacefast as the deploy target (public docs, Oct 2026)

- A Space holds immutable versions and a `live` channel; `sf publish ./dist` uploads changed files; publishing source lets Spacefast detect and build the framework. Recipes for plain HTML, Astro, Next.js, Vite, Eleventy; packages `@spacefast/astro`, `@spacefast/next-adapter`, `@spacefast/vite-plugin`, `@spacefast/wordpress`, `@spacefast/mcp`, CLI `sf`.
- **WordPress data sources** ([docs](https://spacefast.com/docs/wordpress-data-sources)): a Space declares up to 32 public HTTPS WordPress sites; repository builds receive `WORDPRESS_URL` and `SPACEFAST_DATA_SOURCES`; content is read anonymously over REST (`/wp-json/wp/v2/...`, pretty permalinks required). `@spacefast/wordpress` exposes `createWordPressClient()` with `posts|pages|media|categories|tags|users` × `list|get|bySlug`. Sources only reach repository builds, not folder publishes.
- **Rebuild triggers:** the public page says "Build now" or push to the production branch; internal P2s confirm a WordPress plugin that fires rebuilds on content change exists and is heading to release (Batuhan İçöz, 2026-09-15; "Proposal: Spacefast for VIP", 2026-08-17; Dotcom Happiness, 2026-10-20).
- **WordPress on every Space** ([docs](https://spacefast.com/docs/wordpress)): each Space carries a WordPress install behind its static files, reachable with `sf wp …` and Abilities, powering the Zero runtime, Storage and Database. Static Spaces never touch it.
- **Proof it works:** the VIP FDE "Meridian" demo (Chris Dixon, Sept 2026): WordPress as headless CMS over REST + Abilities + an application password for a least-privilege connector user, Astro-style static build on Spacefast, WordPress firing rebuilds at Spacefast, "almost none" of it Automattic-specific.

### 3.5 Other internal signals

- WPGraphQL's creator and maintainer, Jason Bahl, works at Automattic; Corp Dev calls WPGraphQL "the de facto standard for headless WordPress". WPGraphQL for ACF 3.1.0 (2026-10-30) added Secure Custom Fields support.
- Studio Code heavy-user interviews (Sept 2026): nobody asked for headless, but five of sixteen want to deploy somewhere other than WordPress.com/Pressable, developers "start in Studio, finish in their IDE", and six of sixteen top spenders are not developers. Headless must be opt-in and must not displace the non-developer path.
- An internal RSM project ("Letter", Apr 2026) already ran a Next.js 16 frontend against a local Studio backend by hand.
- Woo tracks headless storefront work (WOOPLUG-2822 Store API for headless, WCCOM-2963 headless Woo on Spacefast); VIP marketing published "Headless CMS Myths" (adoption cooling past the hype) in 2026. The demand is real but narrower than 2022's.

## 4. The ecosystem, October 2026 (what we would plug into)

**Data layer.** WPGraphQL 2.26.0 (2026-10-29) is release-heavy and security-focused (query depth limiting on by default since 2.24.0, a security settings review, Site Health recommendations); companions Smart Cache 2.3.4 (with on-demand revalidation via the `graphql_purge` action since 2.2.0), IDE 5.8.0, WPGraphQL for ACF 3.1.0. Core has no "headless" initiative; the relevant core movement is the Abilities API (WP 6.9) and the official MCP Adapter (0.7.1), which ride on REST and Application Passwords. VIP's Block Data API exposes blocks as JSON over REST and GraphQL. REST is always present; GraphQL is an opt-in.

**Frontends.** Next.js dominates: Vercel's `cms-wordpress` example (App Router, WPGraphQL, JWT) and 9d8's `next-wp` (REST, Next 16, 1.3k stars, ships a `next-revalidate` WordPress plugin) are the visible starters. Astro is the rising choice for content sites. Faust.js is alive (`@faustwp/core` 4.1.0 on 2026-10-26, Pages Router only). WP Engine's hwptoolkit (active, last push 2026-10-30) is framework-agnostic: `hwp-previews` 1.0.3, `hwp-documents` 1.0.0, `wpgraphql-logging` 1.0.2, `wpgraphql-webhooks` 0.0.8 ("not yet production-ready"), examples for Next, Astro, Nuxt, SvelteKit, Angular, each on wp-env; its scaffold CLI is still literally `@placeholder/cli`. Gatsby is on life support; VIP archived its Next.js skeleton and decoupled bundle in Feb 2026; Pantheon shut Front-End Sites on 2026-10-01. Nobody ships "scaffold the frontend and provision the backend" in one tool. Faust, FaustWP, Content Blocks and hwptoolkit are WP Engine's and are reference points here, not building blocks.

**Env contract.** Every starter wants the WordPress origin in an env var but the names diverge (`WORDPRESS_URL`, `NEXT_PUBLIC_WORDPRESS_URL`, `NEXT_PUBLIC_WORDPRESS_API_URL`, `WORDPRESS_API_URL`), a hostname for `images.remotePatterns`, a shared secret for previews/revalidation, and often an application password. Spacefast and `next-wp` both use `WORDPRESS_URL`.

**Previews and revalidation.** The contract is stable: WordPress's Preview button opens `<frontend>/api/draft?secret=…&id=…`, the frontend enables Draft Mode and fetches the draft with its own credentials; on publish WordPress POSTs to `<frontend>/api/revalidate` with the secret in a header. The two most-cited pains are previews ("the preview problem", per hwp-previews) and CORS across localhost ports; "editors publish and nothing changes" from silently failing webhooks is third.

**Auth and CORS (verified in core source).** `wp_is_application_passwords_supported()` is `is_ssl() || 'local' === wp_get_environment_type()`; core populates `PHP_AUTH_USER/PW` from `HTTP_AUTHORIZATION` itself, so Basic auth works on `php -S` with no Apache rewrite. Core's `rest_send_cors_headers()` echoes any Origin, sends `Allow-Credentials: true`, `Allow-Headers: Authorization, X-WP-Nonce, Content-Disposition, Content-MD5, Content-Type`, and `rest_handle_options_request()` answers preflights. WPGraphQL sends `Access-Control-Allow-Origin: *` with `Allow-Headers: Authorization, Content-Type, X-GraphQL-Preview` and answers OPTIONS, but no `Allow-Credentials`, so cookie auth on `/graphql` needs a filter on `graphql_response_headers_to_send`. Local by WP Engine never solved CORS (nginx patches since 2020); Studio's native server does not have the problem for REST.

**Competitors.** Local's headless add-on (renamed "WP Engine Headless Platform Add-on" in May 2025, still Beta, new sites only) scaffolds a Faust/Next app into `app-node/` beside `app/`, runs a Node watcher whose output shows under "Frontend Node.js", and adds "Node.js Host" and "Admin" links; it is in maintenance (Dependabot-only since 2025) and Local Connect cannot push the frontend. DDEV and Lando model it as "declare a daemon and a port"; Herd and Valet as "proxy a hostname to a port". wp-env, wp-now and Playground have no headless story; hwptoolkit had to add `hwp-cors-local` and `hwp-wp-env-helpers` mu-plugins to make wp-env usable.

**AI builders.** Lovable has an official WordPress.com connector ("headless CMS apps"); Bolt and v0 rely on REST tutorials and bridge plugins. Their reported friction is CORS and auth, which a local tool controls.

## 5. What Studio has today versus what headless needs

| Need | Today | Gap |
|---|---|---|
| Serve REST and GraphQL locally | `router.php` falls through to `index.php`; pretty permalinks on via mu-plugin | None |
| CORS for a `localhost:3000` frontend | Core handles REST; nothing for `/graphql` credentials | Small mu-plugin for the frontend origin |
| Application Passwords over HTTP | `WP_ENVIRONMENT_TYPE=local` default (`packages/common/lib/wp-environment-type.ts`) | Create one at provisioning (`wp user application-password create … --porcelain`) |
| Install/configure plugins at create | Blueprints via `blueprints.phar`; `runWpCliCommand`; agent `wp_cli` | A headless Blueprint/provisioning step |
| A second long-running process per site | Process-manager daemon runs any Node script (`startProcess(name, scriptPath, {args, env})`) | A `frontend-server-child` wrapper; start/stop coupling; log access; tree kill |
| Per-site config for the frontend | `cli.json` site schema (CLI-acted) and `app.json` metadata (UI-only), both `.loose()` | New optional fields |
| Node/npm on the machine | Nothing; PHP is bundled, Node is not | Detection and, later, a managed runtime like native PHP |
| A URL for the frontend in the UI | Preview realms are path-based within one origin (`address-bar.tsx`) | A new realm/surface with its own origin |
| Previews, view links, revalidation | Nothing | The headless mu-plugin |
| Agent guidance | 14 skills, none headless; `Bash` has no background mode | A `headless-frontend` skill; `site_info`/`site_create` fields; tools for the frontend process |
| Deploy | Push to WordPress.com/Pressable; Spacefast connector in draft | Frontend publish + data-source rewiring |

## 6. Proposal: how it should work for the user

**Creating.** In the Add-site dialog's Create section, and in `studio site create`, a "Frontend" choice: *WordPress theme* (default, unchanged), or *Headless* with a framework: Static HTML (no Node required), Astro, Next.js. Studio creates the WordPress site as today, provisions it as a headless backend (permalinks, a least-privilege frontend user with an application password, the headless mu-plugin, optional WPGraphQL), scaffolds the frontend from a thin Studio template, installs dependencies, starts both, and opens the frontend. A second entry point, "Attach a frontend", points an existing site at an existing folder plus a dev command, for people who already have a Next/Astro repo.

**Working.** The site preview shows the frontend by default, with WordPress, Admin, Database and Design still one click away. Start/Stop control both processes; the frontend's logs are reachable from Tools. Editing content in WP Admin and clicking Preview opens the frontend in draft mode; View on a published post opens the frontend route; publishing pings the frontend's revalidate endpoint, and failures show in the site's debug log rather than vanishing. Open in editor and terminal open the frontend project. Studio Code builds the frontend in the frontend folder, reads content over REST or GraphQL, models content with CPTs and taxonomies through `wp_cli`, and can restart or read logs of the frontend through tools rather than a blocking `Bash` call.

**Shipping.** Share and publish offers: push WordPress to WordPress.com or Pressable as today, and publish the frontend to a Spacefast Space. When both are connected, Studio sets the Space's WordPress data source to the hosted site's URL so `WORDPRESS_URL` flips from `localhost` to production without editing code, and installs the Spacefast rebuild plugin on the hosted site. For a "bake" deployment (Astro static, content fetched at build time) no hosted WordPress is required at all. Other frontend hosts work through the standard env contract and are covered by docs and the skill, not by connectors.

## 7. Proposal: technical design

### 7.1 Site model: a normal site plus a frontend project

Keep `site.path` a plain WordPress install. Record the frontend on the site:

```ts
// cli.json site record (CLI must act on it: start/stop, env, ports)
frontend?: {
  path: string;                  // absolute; default <container>/frontend for new sites
  kind: 'static' | 'command';    // static: Studio serves files; command: a dev server
  framework?: 'static' | 'astro' | 'next' | 'custom';
  devCommand?: string;           // e.g. "npm run dev -- --port ${port}"
  servedDir?: string;            // static kind only, relative to path (e.g. "public")
  port: number;                  // allocated by portFinder, stable across restarts
  customDomain?: string;         // optional .local name for the frontend (HTTPS via the proxy)
  api: 'rest' | 'graphql';       // what the template was generated for
  headlessMode: boolean;         // redirect WP's own front end to the frontend
};
```

For new headless sites the default layout is a container `~/Studio/<name>/` with `wordpress/` and `frontend/`, and the site record's `path` points at `wordpress/`. This gives the one-folder experience of PR #3888 without its `getWpPath()` seam: every existing command sees a WordPress directory and keeps working (push, pull, export, import, Blueprints, previews, `studio wp`). "Attach a frontend" sets `frontend.path` to any folder, so sites created without headless can gain one later. `getSiteContainingFolder` learns to resolve a site from its container or frontend path so `studio wp` works from either.

Why not the PR #3888 container with `site.path` at the root: it touches every site operation and had to disable five of them. Why not put `frontend/` inside the WordPress directory: `router.php` serves any existing file, so source and `node_modules` would be web-reachable, and push would upload them unless ignored.

### 7.2 Two origins, no proxying by default

The frontend runs on its own port and talks to WordPress on the site port. This matches every starter and every production setup, keeps Next.js HMR and Draft Mode cookies on the frontend origin, and avoids teaching Studio's PHP proxy about WebSocket upgrades. CORS is a non-issue for REST (core) and a one-filter fix for credentialed GraphQL. Studio's custom-domain proxy (`apps/cli/lib/proxy-server.ts`) gains the ability to map a second hostname to the frontend port, so a site can be `mysite.local` (frontend) and `wp.mysite.local` (WordPress) with HTTPS from the Studio CA, which also sidesteps Safari's refusal to set `Secure` cookies on `localhost`.

PR #3888's single-origin proxy remains an option for the *static* kind (where there is no HMR) but should not be the default: it hides a difference from production that users then hit on deploy.

### 7.3 The frontend process

A new daemon-managed script `apps/cli/frontend-server-child.ts`, modeled on `php-server-child.ts`:

- `kind: 'static'`: serve `servedDir` with correct content types and path-traversal guards (PR #3888 code, minus proxying). No Node toolchain required, which keeps the "AI writes plain HTML/CSS/JS against REST" path dependency-free.
- `kind: 'command'`: spawn `devCommand` through the user's login shell (so `nvm`, `volta`, `fnm` and Homebrew Node resolve the way the Open-in-terminal feature already does), `cwd` = `frontend.path`, env = process env + the contract below + `PORT`. Readiness = the port accepts connections (not log parsing). Logs go to the daemon's per-process log files and are exposed through `studio site logs --frontend`, a Tools menu entry, and an agent tool. Stop kills the process group (`detached` + negative pid on POSIX, `taskkill /T /F` on Windows); Next.js auto-increments its port on conflict, so Studio passes an explicit port and treats a mismatch as a failed start.
- Lifecycle: `site start` starts WordPress, then the frontend; `site stop` the reverse. The frontend can be restarted alone. Site status reports both.

### 7.4 Node runtime

Phase 1 requires a system Node ≥ 20 for `command` frontends and says so clearly in the create form and the CLI (with the detected version). The static kind needs nothing. Phase 3 adds a managed Node downloaded on demand through the same dependency-management path as the native PHP binaries (`docs/design-docs/native-php-binaries.md`), so the Desktop app can scaffold and run Astro or Next without asking the user to install anything. Package installs use npm (bundled with Node).

### 7.5 The WordPress side: a headless backend profile

Provisioning at create (or on attach), via WP-CLI and a Blueprint-compatible step list so it can also ship as a gallery Blueprint:

1. `rewrite structure '/%postname%/'` (soft flush is enough on the native server).
2. Create a `studio-frontend` user with the Editor role and `user application-password create studio-frontend "Studio frontend" --porcelain`; write the password into the frontend's `.env.local` as a server-side variable (never `NEXT_PUBLIC_*`). Least privilege, as in Meridian.
3. Optional: `plugin install wp-graphql --activate` (+ Smart Cache) when `api: 'graphql'`; set the headless-safe security defaults WPGraphQL 2.24+ recommends and enable introspection locally.
4. Generate `STUDIO_PREVIEW_SECRET` and `STUDIO_REVALIDATE_SECRET`.

A Studio mu-plugin `0-headless.php` in `~/.studio/mu-plugins/` (loaded only when the site has a frontend, through `MuPluginOptions`), reading constants injected by the existing prepend file (`STUDIO_FRONTEND_URL`, the secrets, `STUDIO_HEADLESS_MODE`):

- CORS: reflect the frontend origin with credentials on `/graphql` via `graphql_response_headers_to_send` and `graphql_access_control_allow_headers`; extend `rest_allowed_cors_headers` only if needed.
- Previews: `preview_post_link` → `<frontend>/api/draft?secret&id&type&status`. The parameters are Studio's own contract, implemented by the templates' draft route; the same route serves production once the WordPress side ships as our plugin (section 9).
- View links: `post_link`, `page_link`, `post_type_link`, `term_link` → frontend routes, skipped during REST and GraphQL requests so APIs return raw data.
- Revalidation: on `transition_post_status`, `save_post`, term and media changes (or `graphql_purge` when Smart Cache is active) POST `{ paths, tags }` to `<frontend>/api/revalidate` with the secret in a header, non-blocking, 5 s timeout, with failures written to the debug log so "nothing changed" has a visible cause. Trust the Studio CA for local HTTPS frontends.
- Headless mode (toggle): redirect non-admin, non-API, non-asset requests to WordPress's own front end to the frontend, the Headless Mode plugin behavior without its 2024-era staleness.
- Admin hygiene (toggle): hide Appearance → Themes/Editor and the Customizer, add a dashboard notice naming the frontend. Keeps the block editor for content.

Living in `~/.studio/mu-plugins/` means it is never pushed. Production parity is a separate decision (see open questions): the same code published as an Automattic plugin that the agent installs on the hosted site alongside Spacefast's rebuild plugin, since no WP Engine plugin can fill that role.

### 7.6 Frontend templates and the env contract

Thin, Studio-owned templates (a handful of files, versioned in the repo or fetched like Blueprints from the Studio API), not framework `create-*` wizards, so the glue is right on first run and the agent owns everything else:

- `static`: `public/index.html` that fetches `/wp-json/wp/v2/posts` client-side; nothing else.
- `astro`: `package.json`, `astro.config.mjs` (`@spacefast/astro` adapter optional), a data layer using `@spacefast/wordpress` or plain `fetch`, `.env` with the contract, a draft endpoint when running in server mode.
- `next`: `package.json`, `next.config.ts` with `images.remotePatterns` for the WordPress host and port, `app/api/draft/route.ts` and `app/api/revalidate/route.ts` honoring the contract, a `lib/wordpress.ts` client (REST by default, a GraphQL variant when chosen), `.env.local`.

Env contract written by Studio into `.env.local` (and injected into the process env):

```
WORDPRESS_URL=http://localhost:8881          # matches Spacefast data sources and next-wp
WORDPRESS_HOSTNAME=localhost                 # for images.remotePatterns
WORDPRESS_GRAPHQL_URL=http://localhost:8881/graphql   # only when api=graphql
WORDPRESS_APPLICATION_USER=studio-frontend
WORDPRESS_APPLICATION_PASSWORD=…             # server-side only
STUDIO_PREVIEW_SECRET=…
STUDIO_REVALIDATE_SECRET=…
PORT=3000
```

For attached frontends with other conventions (`NEXT_PUBLIC_WORDPRESS_URL`, `NEXT_PUBLIC_WORDPRESS_API_URL`, `NEXT_PUBLIC_GRAPHQL_ENDPOINT`), Studio offers a small mapping and the agent reads the project's `.env.example`.

### 7.7 Studio Code

- A `headless-frontend` skill in `packages/agent/node/skills/` holding the procedure: build in the frontend folder, fetch over REST/GraphQL, model content with CPTs/taxonomies via `wp_cli`, implement the draft and revalidate routes against the contract, verify with screenshots, deploy through Spacefast. Routing sentence in `SKILL_ROUTING`. `build-site`, `edit-manage-site`, `annotate`, `need-for-speed`, `rank-me-up` and `visual-*` get a line each: on a headless site the target is the frontend URL and fixes go in frontend code, not plugins or `theme.json`.
- Tools: `site_create` gains `frontend` (framework, api); `site_info`/the active-site context line report `frontend.path`, URL, framework and the API endpoints; new `frontend_restart` and `frontend_logs` (so the agent never runs `next dev` through `Bash`, which has no background mode); `take_screenshot`, `inspect_design`, `audit_performance`, `audit_seo` and `refresh_browser` default to the frontend URL on headless sites. The `site-preview` chat artifact gains a frontend target. UI-only behavior stays gated on `host.ui`.
- Site-level `AGENTS.md`/`STUDIO.md` for headless sites describe both halves; the frontend folder gets its own `AGENTS.md`.
- Evals: new cases in `scripts/eval/` for "create a headless site", "add a post type and render it", "wire previews", plus assertions that existing cases do not start scaffolding themes on headless sites.

### 7.8 UI (`apps/ui`, both connectors)

- Add-site dialog: a Frontend choice in the create form (`CreateSiteFormValues`, `CreateSiteParams`, `buildSiteCreateArgs`, IPC `createSite` and `POST /api/sites`), plus an "Attach a frontend" action in the site menu.
- Preview: a `frontend` realm and surface with its own origin, default for headless sites; the address bar lists Frontend, WordPress, Admin, Database, Design. Annotate and Responsive mode work on the frontend.
- In-app preview of the frontend is a requirement, not a nice-to-have, and it is feasible (section 7.9).
- Site menu: Start/Stop/Restart cover both; Tools → Frontend logs; Open in → editor and terminal open the frontend project; WP Admin links keep targeting WordPress with auto-login.
- Site settings: a Frontend group (path, framework, dev command, port, local domain, headless mode, admin hygiene, detected Node).
- Share and publish: the Spacefast tab from #5567 publishes the frontend for headless sites (source publish for Astro/Next, folder publish for static); WordPress.com/Pressable tabs push WordPress.
- Every connector method is implemented in `ipc` and `local`, with the operation in `@studio/common` (per AGENTS.md "Two Front Ends, One Feature"). Verified in light and dark.

### 7.9 In-app preview of the headless frontend

Viewing the frontend in Studio's own browser pane must keep working; this is one of the few things the two-origin design has to pay for, and the cost is contained.

- **Desktop.** The preview is an Electron `<webview>` (`apps/ui/.../preview-surface/webview-surface.tsx`), a separate top-level guest page. It can load `http://localhost:3000` as readily as a WordPress page: no framing headers apply, Next.js and Astro HMR connect from the guest to its own origin, Draft Mode cookies are set on the frontend origin where the guest already is, and the annotation inspector injected into the page (`packages/agent/node/inspector/`) works on any document. Thumbnails, Responsive mode and Playwright screenshots take a URL and are origin-agnostic.
- **What changes.** Surfaces are keyed by realm and built as `siteUrl + path` (`site-preview/index.tsx`, `surfaces.ts`), and `getPreviewRealm(path)` is path-based within one origin. Headless sites need a surface whose origin is the frontend URL (a `frontend` surface beside the existing `site` surface, which becomes "WordPress + Admin"), realm detection by origin as well as path, and the address bar showing the frontend URL. The site menu's "Open in browser" and the `site-preview` chat artifact pass the frontend URL for headless sites.
- **Cross-origin navigation guards.** The main process treats any navigation or popup to an origin other than the page currently shown as "another site" and sends it to the external browser (`isOtherSiteThanPreview`, `openSitePreviewPopupUrl` in `apps/studio/src/index.ts`). For a headless site both origins are "this site": the guard must accept the set {frontend URL, WordPress URL} for the current site so that Preview and View links in WP Admin open in the pane, and a link from the frontend to `/wp-admin` stays in the pane. The WP Admin realm's `target="_blank"` Preview button is already handled by the popup handler, which loads same-site popups in the pane.
- **`studio ui` in a browser.** The fallback is a plain `<iframe>`, so the frontend must allow framing by the Studio UI origin. Next.js and Astro dev servers send no `X-Frame-Options` by default; the templates must not add a restrictive `frame-ancestors` in development, mirroring what Studio's `0-allow-localhost-framing.php` mu-plugin does for wp-admin.
- **Single-origin alternative.** PR #3888's proxy made the frontend *be* the site URL, so the preview needed no changes. It remains available for the static kind, but for dev servers the two-origin preview above is a smaller change than teaching the PHP proxy about WebSocket upgrades and hiding a production difference.

### 7.10 Deploy, end to end

1. Push WordPress to WordPress.com (Business+, WPGraphQL available in the marketplace) or Pressable as today.
2. Publish the frontend to a Space through the #5567 connector. For Astro/Next, publish source so Spacefast builds it; for static, publish the folder.
3. Studio patches the Space config (`PATCH /v1/spaces/{id}`, replacing the overlay) to set the default WordPress data source to the hosted site's HTTPS URL, so builds get `WORDPRESS_URL` without code changes; for "bake" deployments the data source can be the hosted site or none.
4. Install the Spacefast rebuild plugin (and, once it exists, the Automattic headless plugin from section 9) on the hosted site; until then the skill documents "Build now" and Git push.
5. Pull-back-to-edit: WordPress via `pull` as today; the frontend via Git (Spacefast has built-in Git) or the local folder. Studio does not sync frontend code.

Production previews and revalidation reuse the same frontend routes; the WordPress-side piece on the hosted site is the open question in section 9.

## 8. Phasing

| Phase | Scope | Surfaces | Exit criterion |
|---|---|---|---|
| 0 (now) | Land #5567. Document "Studio as a headless backend today" (REST, app passwords, `WORDPRESS_URL`) on wordpress.studio and in the `wp-rest-api` skill. | Docs, skill | Published |
| 1: CLI + agent experiment | Site model (7.1), frontend child for static and command kinds (7.3), system-Node detection (7.4), headless profile and mu-plugin (7.5), `static` and `astro` templates with the env contract (7.6), skill and tool changes (7.7), `studio site create --frontend`, `site status`, logs, Tracks events. Hidden in Desktop behind a flag; visible in `studio ui` for dogfooding. | CLI, `@studio/common`, agent | Create → agent builds → preview → publish frontend to Spacefast, from a terminal, with evals green |
| 2: Desktop and `studio ui` | Create form, Attach, preview realm, menu, settings, logs, publish tab (7.8); `next` template; GraphQL option; custom domain for the frontend. | `apps/ui`, Desktop IPC, `apps/local` | Feature flag on by default for a cohort; both color schemes verified |
| 3: Production loop | Data-source rewiring and rebuild plugin install on push (7.10); production preview/revalidation parity; managed Node runtime; GraphQL codegen in the `next` template; mobile/app clients via Abilities. | All | Decided from phase 1–2 metrics |

Phase 1 is the fair version of the June experiment: local creation and agent authoring plus one real deploy target. It is roughly the size of PR #3888 plus the Astro template and the mu-plugin, and most of it is CLI and `@studio/common` code with unit tests.

## 9. Risks and open questions

- **Node is not bundled.** The Desktop app cannot assume npm exists. Phase 1 mitigates with detection, the static kind and clear messaging; phase 3 bundles. Running `npm install` for a template also needs network at create time (as Local's add-on does).
- **Token cost.** Interviews say credits run out mid-task on block themes; a framework frontend plus iteration is heavier. The thin templates and a skill that discourages rewrites help; cost estimates (STU-2375) matter more here.
- **Positioning.** Six of sixteen top spenders are not developers. Headless stays opt-in, never the default, and the create form should say what the user gives up (plugins that render on the front end, comments, the Customizer).
- **Production parity of the WordPress-side glue.** Local previews, view links and revalidation come from a Studio mu-plugin that is never pushed. The off-the-shelf equivalents (FaustWP, hwp-previews, wpgraphql-webhooks) are WP Engine's and excluded, and the community Headless Mode plugin is stale (2024). The realistic option is publishing the mu-plugin's code as an Automattic plugin (possibly under the WPGraphQL umbrella) that the agent installs on the hosted site, paired with Spacefast's rebuild plugin. Needs a decision before phase 3.
- **Sync semantics.** `push` must never upload the frontend; the container layout guarantees that. Export/import of a headless site exports WordPress only; the frontend is a Git repository. Say so in the UI.
- **Security.** The application password is a real credential; it belongs to a least-privilege user, stays server-side, and the preview and revalidate secrets are per site. The VIP incident vip-breaking-1449 (admin users created via a headless frontend's REST method override) is the cautionary tale for templates.
- **Windows.** Process-tree kill, login-shell PATH resolution and path handling need the same care the PHP child got.
- **WordPress admin mismatch.** Brian's list: the block editor does not match the frontend, Appearance menus are misleading, some plugins do nothing. Mitigations are the admin-hygiene toggle, view/preview link rewriting and the plugin-recommendations skill marking frontend-rendering plugins as not applicable. Content modeling UI (SCF-style) is explicitly out of scope; agents use raw primitives.
- **REST vs GraphQL default.** REST needs nothing and matches Spacefast's data-source client; WPGraphQL is what most tutorials and Vercel's example use, is stewarded from Automattic, and is the one headless building block we can shape (for example a Studio-aware preview and revalidation story under its umbrella). Default REST for the zero-setup path, offer GraphQL at create, make the templates work with either, and revisit the default after phase 1.
- **Spacefast coupling.** Data sources require a public HTTPS WordPress, so the production loop needs a hosted WordPress or a bake deployment. Spacefast is pre-GA; the connector's device-login key and public-by-default Spaces are #5567 open questions that carry over.

## 10. Alternatives considered

- **Docs only ("point your app at Studio").** Cheapest and worth doing in phase 0, but it leaves previews, revalidation, process supervision, deploy and agent integration to the user, which is exactly the glue the June thesis says we should sell.
- **PR #3888 as-is (container with `site.path` at the root, single-origin proxy, static only).** Rejected for the seam through every site operation and the production mismatch of one origin.
- **Static export only (#5567).** Serves a different user; does not deliver "the model writes any markup". Keep it, share the connector.
- **A Faust-style framework of our own.** The ecosystem has moved to framework-agnostic plugins and thin starters; WP Engine's own scaffold CLI is still a placeholder. Studio should own the glue, not a framework.
- **Hybrid "drop the app into WordPress" (DesignSetGo).** Riad's objections (design consistency, performance) stand; it does not address the market segment leaving for Vercel-class hosts.

## 11. What to measure

Tracks on `studio_site_created` (`site_type: headless`, `frontend_framework`, `api`), frontend starts and failures (with Node detection outcome), agent sessions on headless sites and their credit use versus theme sites, Spacefast publishes from headless sites, and 30-day retention of headless sites versus theme sites. The June question was "is there appeal"; with a deploy target wired in, the answer is measurable.

## 12. Key sources

Internal: [P2: Opportunity: Headless WP and static sites in Studio](https://studioapp2.wordpress.com/2026/06/18/opportunity-headless-wp-and-static-sites-in-studio/); [PR #3888](https://github.com/Automattic/studio/pull/3888); [PR #5567](https://github.com/Automattic/studio/pull/5567) and [STU-2617](https://linear.app/a8c/issue/STU-2617); [Meridian on VIP + Spacefast](https://vipfde.wordpress.com/2026/09/15/meridian-a-headless-festival-site-on-wordpress-vip-and-what-a-customer-actually-needs-to-build-it/); [Spacefast: pivot to boring](https://spacefastp2.wordpress.com/2026/08/18/pivot-to-boring-spacefast-is-hosting-with-superpowers/); [Proposal: Spacefast for VIP](https://vipproductp2.wordpress.com/2026/08/17/proposal-spacefast-for-vip/); [What we learned from Studio Code's heaviest users](https://studioapp2.wordpress.com/2026/09/14/what-we-learned-from-studio-codes-heaviest-users/).

External: [Spacefast docs: WordPress data sources](https://spacefast.com/docs/wordpress-data-sources), [WordPress on every Space](https://spacefast.com/docs/wordpress); [WPGraphQL releases](https://github.com/wp-graphql/wp-graphql/releases); [WPGraphQL Smart Cache on-demand revalidation](https://www.wpgraphql.com/docs/smart-cache/on-demand-revalidation); [hwptoolkit](https://github.com/wpengine/hwptoolkit) and [hwp-previews](https://github.com/wpengine/hwptoolkit/tree/main/plugins/hwp-previews); [Faust.js releases](https://github.com/wpengine/faustjs/releases); [next-wp](https://github.com/9d8dev/next-wp); [Vercel cms-wordpress example](https://github.com/vercel/next.js/tree/canary/examples/cms-wordpress); [Next.js Draft Mode](https://nextjs.org/docs/app/guides/draft-mode) and [ISR](https://nextjs.org/docs/app/guides/incremental-static-regeneration); [Local: Headless Platform add-on](https://localwp.com/help-docs/local-features/using-the-headless-wp-add-on/); [WordPress core `rest-api.php`](https://github.com/WordPress/wordpress-develop/blob/trunk/src/wp-includes/rest-api.php) and [`user.php`](https://github.com/WordPress/wordpress-develop/blob/trunk/src/wp-includes/user.php); [WordPress.com: choosing headless hosting](https://wordpress.com/blog/2026/04/14/how-to-choose-headless-wordpress-hosting/); [MCP Adapter](https://wordpress.org/plugins/mcp-adapter/).
