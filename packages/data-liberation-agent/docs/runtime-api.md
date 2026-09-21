# Embedded runtime

Data Liberation exposes its existing product operations through a generic Node API:

```js
import {
  inspectSource,
  captureWebsite,
  checkFidelity,
  publishSite,
  registerPlatform,
  registerPublishTarget,
} from 'data-liberation/runtime';
```

`data-liberation` and `data-liberation/runtime` resolve to the **same module**, including the same platform and publish registries. The runtime uses the implementations used by the CLI and MCP, with no separate pipeline, destination policy or sandbox configuration.

## Standalone distribution

The committed **`dist/capture-engine.bundle.mjs`** now exports the full runtime. Its historical filename is retained for consumers that already pin that artifact. An embedded runner can import the file directly:

```js
import { inspectSource, captureWebsite, checkFidelity } from './capture-engine.bundle.mjs';
```

Node 22 or later is required. The bundle includes ordinary JavaScript dependencies. Importing it, registering platforms/publish targets, HTTP-only inspection and publishing to an in-process target work without Playwright or the source checkout.

Browser operations require separately provisioned **Playwright and Chromium**. Provision them in an ancestor `node_modules` visible to the bundle, and make the installed browser cache available to the runtime user. The installed-package gate copies only `playwright` and its `playwright-core` dependency beside a relocated bundle before exercising the browser workflow. `single-file-cli` remains an optional external dependency of the existing freeze path. No runtime operation installs dependencies.

Use a tested immutable DLA revision and provision browser dependencies during environment construction. A dependency pin baked into an existing environment must be rebuilt to receive a newer bundle.

## Operations and failure behavior

| Operation | Inputs | Result and failure contract |
| --- | --- | --- |
| `inspectSource(url, options?)` | Bounded discovery/rendering options; `rendered: false` selects HTTP-only | `SourceInspection`, including complexity factors, coverage, unknowns and issues. Missing browser support becomes `browser-unavailable` and unknown complexity. Invalid input or an unrecoverable entry request rejects. |
| `captureWebsite(options)` | `url`, `outputDir`, optional `resume`, `captureImages`, `learnFluid`, `strict`, `onProgress` | `CaptureResult` with receipt path, route counts, `complete`, and `unresolvedAnchors`. A partial site still resolves with `complete: false` unless `strict: true`, which rejects with `IncompleteCaptureError`. Callers must inspect `complete` rather than inferring coverage from counters. Setup errors reject. Output follows the existing cwd-local path contract. |
| `checkFidelity(options)` | `directory`, optional widths/sample size/screenshots/settling/log callback | `FidelityReport`. `pass: false` means measured fidelity or offline checks failed. Invalid artifacts, unavailable browser support and failed cleanup audits reject. Cleanup-aware comparison consumes the policy recorded by capture. |
| `publishSite(options)` | `directory`, `target`, optional credentials/log callback | `PublishResult` from the selected target. Publishing is an explicit operation. Target and setup failures reject; optional attribution runs in disposable staging. |

Types are exported for all options/results, including `InspectOptions`, `CaptureOptions`, `CaptureResult`, `FidelityCheckOptions`, `FidelityReport`, `PublishSiteOptions`, and `PublishResult`.

An application can compose these operations while keeping its acceptance policy explicit:

```js
export async function prepareSource(url, outputDir, acceptSource) {
  const inspection = await inspectSource(url, { sampleLimit: 5 });
  if (!acceptSource(inspection)) throw new Error('Source needs review');

  const capture = await captureWebsite({ url, outputDir });
  if (!capture.complete) throw new Error('Capture is incomplete');

  const comparison = await checkFidelity({ directory: outputDir });
  if (!comparison.pass) throw new Error('Captured site failed fidelity checks');

  return { inspection, capture, comparison };
}
```

Inspection and comparison are advisory/results APIs, not automatic gates inside capture. Capture can emit existing diagnostic logging; a host that reserves stdout for its own protocol must account for that output. All asynchronous operations should be awaited so browser/context cleanup completes.

## Extension points

Import registration and operations from this runtime entry. Custom platforms contribute discovery, inspection signals and cleanup rules through [`registerPlatform`](platform-api.md). Destinations contribute publishing and optional attribution through [`registerPublishTarget`](source-cleanup.md). The bundle and package share the exact public contract; callers need no internal `src/` imports or MCP transport to use it.

## Verification

Tracking: https://github.com/Automattic/data-liberation-agent/issues/215

```sh
npm ci
npm run setup:browser
npm run build
npm run test:package
npm test -- --maxWorkers=2 --testTimeout=45000
```

`test:package` installs the packed package into a separate consumer and verifies runtime/root module identity and TypeScript imports. It then copies just the committed bundle into two standalone directories:

1. **No dependencies:** real HTTP inspection, graceful missing-browser inspection/comparison failure, custom platform registration, and in-process publishing with destination attribution.
2. **Only Playwright/core provisioned:** rendered inspection of JS-created application content, custom-platform capture with cleanup, comparison of the portable artifact, rejection of deliberately removed owner content, and publishing without modifying the canonical artifact.

The workflow is implemented in `scripts/test-runtime.mjs` and runs against a local HTTP fixture. It asserts emitted artifacts and outcomes, rather than only export names. It performs no external publish.

AI assistance: OpenAI gpt-6-astra via OpenCode implemented and verified this generic distribution change directly in an isolated worktree under Chris Huber's direction.
