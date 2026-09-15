# Source cleanup and destination attribution

Tracking: https://github.com/Automattic/data-liberation-agent/issues/211

Capture applies a versioned source cleanup policy by default before settling, HTML, screenshots, responsive evidence and interaction capture. A bounded mutation observer removes matching late-inserted nodes. The eight built-in platform adapters supply provider identities; shared mechanics remove provider credit links and plain-text footer credits while preserving the owner's copyright, footer content and authored articles about platforms.

Wix free banners and Webflow badges have explicit rules. Generic rules recognize declared advertising slots, Google advertising frame identifiers, advertising-network script/frame hosts, and Outbrain/Taboola containers. Provider acquisition-bar recognition is shared with overlay detection and legacy export cleanup. Host recognition for provider links and network rules compares URL hostnames, not incidental query-string mentions.

Removal collapses the matched slot and up to four empty ad-only wrappers. A fixed bar's matching top/bottom body padding is reclaimed. Normal content landmarks and mixed-content parents are retained. Plain-text credits spanning styled spans are removed by text range, preserving surrounding owner text.

## Extension API

```ts
import { registerPlatform, providerCreditRules } from 'data-liberation';

registerPlatform({
  id: 'example-builder',
  discover: discoverExampleRoutes,
  liberation: {
    cleanupRules: [
      ...providerCreditRules('example-builder', ['builder.example'], 'Example Builder'),
      { id: 'builder-badge', category: 'source-attribution', selector: '.builder-badge' },
      { id: 'builder-ad', category: 'advertisement', selector: '[data-builder-ad]' },
    ],
  },
});
```

The policy is persisted in `capture-receipt.json`. Per-page/viewport removal evidence lives in `cleanup-evidence.json`: matched rule/category, bounded selector/text, action, padding treatment, failures, truncation and detected residuals. A resumed capture with an absent or different policy is recaptured. Policy-schema changes are required when removal semantics change.

Limits: at most 100 rules, 1,000 removal actions per viewport, 100 mutation batches, and 200 detailed records. Invalid selectors, residual matches at the action limit and exhausted mutation processing fail capture/comparison instead of silently succeeding. Record truncation is reported separately from rule execution failure.

This is rule-based recognition, not a claim that arbitrary first-party sponsored content can always be distinguished from owner content. Retained embedded surfaces and open shadow roots are explicitly reported as uninspected. `cleanup.complete` means the recorded rule execution completed; it is not a universal ad-detection guarantee. Consumers can inspect `unknowns` and extend rules for additional sources.

## Comparison

`compare` replays the capture's exact supported policy on the live source before text, image, typography and geometry observations. It records reference-side removals in `compare/cleanup-evidence.json` and logs the removal count. Retained-content checks remain active; there is no rectangular mask or tolerance exemption for arbitrary missing content.

The candidate is also audited: a matching ad or source credit remaining in the liberated artifact fails comparison. An interrupted/failed comparison writes `completed: false` cleanup evidence instead of leaving a previous successful report looking current.

An incomplete recorded cleanup or unsupported policy fails explicitly. Older captures without a policy are compared against the original unnormalized source and identified as legacy in the log; recapture to use cleanup-aware comparison.

## Publish targets

The public package exports `registerPublishTarget`, `publishSite` and their types. A target may provide an optional `attribution({ directory })` hook. It receives a disposable staging copy before `publish` receives that same directory. Staging is removed on success, attribution failure or publish failure. The canonical liberated directory is unchanged. Targets without the hook add no DLA attribution.

```ts
import { registerPublishTarget, publishSite } from 'data-liberation';

registerPublishTarget({
  name: 'example-host',
  async attribution({ directory }) {
    // Add the destination's chosen attribution to its staging copy.
    await addHostAttribution(directory);
  },
  async publish({ directory }) {
    return uploadToExampleHost(directory);
  },
});
await publishSite({ directory: './run', target: 'example-host' });
```

## Reproduce verification

```sh
npm ci
npx tsc --noEmit
npx vitest run src/lib/source-cleanup.test.ts src/ui/publish.test.ts
npm test
npm run build
npm run test:package
node dist/cli.js https://example.com --output .tmp-test/cleanup-live --no-learn-fluid
node dist/cli.js compare .tmp-test/cleanup-live/example.com
```

The browser fixtures cover a free banner, split-span footer credit, owner copyright, authored platform discussion, inline/framed/late ads, and reclaimed spacing at desktop/mobile widths. The actual screenshot capture/export pipeline produces a clean artifact, cleanup-aware comparison passes, and deleting retained owner content fails. Publisher tests verify default output, destination attribution, immutable source and cleanup on both failure paths. Invalid cleanup selectors produce recorded failures.

Final integration with merged inspection PR #212 passed 96 files / 1,001 tests using `npm test -- --maxWorkers=2 --testTimeout=45000`, plus build/typecheck and installed-package checks. Lower concurrency and a longer per-test timeout were used after a busy-controller run timed out; the timed-out browser test passed in isolation. The 128 MiB export test also passed in isolation and in the final full run without changing its heap limit.

On September 15, 2026, the built public-source workflow captured `example.com` (1/1 routes) and passed comparison at 1600px, 1728px and the 390px interaction check, with zero offline findings. That source has no ads or provider credits: the removal behavior is proven by controlled browser fixtures rather than inferred from that public-source pass.

AI assistance: OpenAI gpt-6-astra through OpenCode implemented and verified this work directly in an isolated worktree under Chris Huber's direction. Homeboy failed before provider execution; direct implementation followed the user's instruction to bypass it.
