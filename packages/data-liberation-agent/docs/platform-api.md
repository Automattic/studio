# Platform API — custom platforms for Data Liberation

Data Liberation's platform layer is a public, registration/composition API. A
*Platform* owns its automatic-detection signals, must be able to discover a
site's routes, and may optionally customize how each page is liberated. Platform ids are **opaque
strings** — there is no enum to extend and no core file to edit: you register a
platform, and it immediately participates in automatic detection, adapter
resolution, discovery, and liberation alongside the built-ins.

The public import surface is the package root:

```ts
import {
  registerPlatform,
  detectPlatform,
  registeredPlatforms,
} from 'data-liberation';
```

Internal orchestration is deliberately **not** exported — the `exports` map in
`package.json` exposes only `.` (the Platform API) and `./package.json`.

## The `Platform` contract

```ts
interface Platform {
  /** Opaque, stable, unique id, e.g. 'acme-builder'. */
  id: string;
  /** This platform's automatic-detection signals (all tiers optional). */
  detection?: PlatformDetection;
  /** Inventory a site: sitemap/routes/navigation. THE required capability. */
  discover(url: string, opts: Record<string, unknown>): Promise<unknown>;
  /** Optional source-specific hooks applied during liberation. */
  liberation?: LiberationHooks;
}
```

`LiberationHooks` (optional) mirrors the hooks built-in platforms use:

```ts
interface LiberationHooks {
  /** CSS selectors removed before portable artifacts are produced. */
  removeSelectors?: string[];
  /** Imperative page prep (wait-for-app, conditional removal). Best-effort. */
  prepare?(page: Page, ctx: { url: string; viewport: 'desktop' | 'mobile' }): Promise<void>;
  /** Per-viewport image variants as {stable media id → variant URL}. */
  responsiveImages?(page: Page, ctx: { url: string; viewport: 'desktop' | 'mobile' }): Promise<Record<string, string>>;
}
```

## Detection signals

Detection is tiered; each platform declares only the tiers it can fingerprint.
The engine (shared, in core) runs them in a fixed order and never hardcodes a
platform:

1. **`urlPatterns: RegExp[]`** — tested against the site URL before any fetch
   (match → high confidence, no network round-trip).
2. **`httpSignals`** — response-header fingerprints, tested on the initial
   fetch (high confidence). `{ header, value?, signal }` — when `value` is set
   it must appear (case-insensitively) in the header value.
3. **`sourceSignals`** — regexes over the fetched HTML (medium confidence),
   consulted only when no header matched.
4. **`pathProbes`** — same-origin `HEAD` probes
   `{ path, expectedStatus, locationContains?, signal }`, fired only when
   every tier above failed (they cost an extra round-trip; match → high
   confidence).

Every match records its human-readable `signal` string in the
`DetectionResult.signals` evidence list. Detection consults platforms in
registration order; if several platforms' signals match one response, the last
matching platform wins — deterministic, and in practice only reachable when
custom platforms deliberately share fingerprints.

`detectPlatform(url)` (alias of the internal `detect`) returns
`{ url, platform, confidence: 'high' | 'medium' | 'low', signals: string[] }`,
with `platform: 'unknown'` when nothing matched.

## Registration and resolution

```ts
import { registerPlatform } from 'data-liberation';

registerPlatform({
  id: 'acme-builder',
  detection: { /* … */ },
  discover: async (url, opts) => ({ /* inventory */ }),
  liberation: { removeSelectors: ['.acme-cookie-banner'] },
});
```

- `registeredPlatforms()` — all platforms, registration order.
- `findPlatform(id)` — exact-id lookup, never falls back.
- `resolvePlatform(id)` — exact match, else the generic fallback.
- `fallbackPlatform()` — the one registered fallback.

Registration failures are deterministic throws (never silent shadowing):

| Error | When |
|---|---|
| `DuplicatePlatformError` | the id is already registered (including built-ins) |
| `ConflictingFallbackError` | `{ fallback: true }` when a fallback already exists |
| `InvalidPlatformError` | malformed platform, `id: 'unknown'` (reserved), or a fallback that also declares detection signals (ambiguous) |

The built-in generic fallback (`default`) is registered through this same API
(`src/platform/builtins.ts`); custom platforms simply join the same registry.

## Discovery — the required capability

`discover(url, opts)` returns a route inventory. The liberation pipeline reads:

```ts
{
  siteMeta?: { title?: string };
  urls?: Array<{ url: string; type: string }>;   // e.g. 'homepage' | 'page' | 'post' | 'product'
  diagnostics?: Array<{ code: string; url: string; reason: string }>;
}
```

Anything beyond these fields belongs to your platform (the built-in extract-era
adapters return richer inventories).

## Registered package consumer (Node)

`docs/examples/custom-platform.mjs` is a runnable example against an installed
package:

```sh
mkdir consumer && cd consumer
npm install /path/to/data-liberation-agent-<version>.tgz
cp ../docs/examples/custom-platform.mjs .
node custom-platform.mjs            # → registers, then prints the detection result
```

<details>
<summary>The example itself</summary>

```js
import { registerPlatform, detectPlatform } from 'data-liberation';

registerPlatform({
  id: 'acme-builder',
  detection: {
    urlPatterns: [/acme-builder\.example/i],
    httpSignals: [{ header: 'x-generator', value: 'acme', signal: 'X-Generator: acme header' }],
    sourceSignals: [{ pattern: /cdn\.acme-static\.example/i, signal: 'acme CDN in page source' }],
  },
  async discover(url) {
    return { siteMeta: { title: 'Acme site' }, urls: [{ url, type: 'homepage' }] };
  },
  liberation: { removeSelectors: ['.acme-cookie-banner'] },
});

console.log(await detectPlatform('https://blog.acme-builder.example/'));
// { url: …, platform: 'acme-builder', confidence: 'high', signals: [ 'URL contains acme-builder domain' ] }
```

</details>

Once registered in-process, the platform flows through the main liberation
workflow with no further wiring: detection selects it, `discover` supplies the
routes, and its `liberation` hooks prepare source pages for the portable artifact.

## Claude Code consumer

A Claude Code plugin install runs the bundled MCP server — third-party code
cannot import into that process, so custom platforms are loaded at boot from
the `DATA_LIBERATION_PLATFORMS` environment variable (comma- or
whitespace-separated module paths). Point your `.mcp.json` (or project MCP
config) at a module whose default initializer receives the active registry API:

```jsonc
// .mcp.json (project-local MCP config)
{
  "mcpServers": {
    "data-liberation": {
      "command": "node",
      "args": ["scripts/mcp-launcher.mjs"],
      "env": {
        "DATA_LIBERATION_PLATFORMS": "/abs/path/to/my-platforms/acme.mjs"
      }
    }
  }
}
```

```js
// /abs/path/to/my-platforms/acme.mjs
export default function ({ registerPlatform }) {
  registerPlatform({ id: 'acme-builder', /* detection, discover, liberation */ });
}
```

The initializer receives `registerPlatform` from the running server. This keeps
registration attached to the correct registry when the plugin runs its
self-contained MCP bundle; importing the package root from this module would
load a separate module instance.

A failing module is reported on stderr and skipped; it never takes the server
or the built-in platforms down. `liberate_detect` then reports custom
platforms by id, and the MCP liberation and discovery workflows route to them.

## Adding a BUILT-IN platform (core contributor path)

1. Create `src/adapters/<platform>/` with `index.ts` (assembling the adapter)
   and `detection.ts` (its `PlatformDetection` signals) — the signals live
   with the platform, not in a central table.
2. Add ONE `registerPlatform(...)` line in `src/platform/builtins.ts`.
3. Update the supported-platforms table in `README.md`.

There is no enum, no switch, and no second registry to edit: detection and
adapter resolution read the same registry your line populated.
