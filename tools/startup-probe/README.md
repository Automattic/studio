# STU-1622 Windows startup experiment

This branch is a disposable diagnostic experiment for [STU-1622](https://linear.app/a8c/issue/STU-1622), comparing trunk with [draft PR #5791](https://github.com/Automattic/studio/pull/5791). Its minimal Buildkite pipeline is for a manual Windows run; it is not intended to merge.

The runner downloads the seven reported plugins from WordPress.org, checks their pinned versions and archive hashes, activates them, and creates 5,000 synthetic WooCommerce products with URL metadata. It uses PHP 8.3 and a site path containing Japanese characters. It exports one backup, sets its PHP metadata to 8.3 (the exporter currently records the default PHP version), imports that same archive into each variant, and measures startup after import plus three stop/start cycles. Every successful measurement must retain all seven active plugins and the product count, report PHP 8.3, and return HTTP 200 from the homepage.

`build.mjs` builds both variants from the same checkout, restoring the two production files changed by the draft from their recorded commit. No artificial delays or fake clocks are used. `run.mjs` records platform details, plugin and PHP versions, archive hashes, timings, CLI output, and daemon logs under `test-results/startup-probe/`.

After installing dependencies and bundled WordPress assets:

```sh
node tools/startup-probe/build.mjs
node apps/cli/dist/startup-probe/draft/main.mjs site list
STARTUP_PROBE_REQUIRE_WINDOWS=1 STARTUP_PROBE_PRODUCTS=5000 node tools/startup-probe/run.mjs
```

The customer backup is unavailable. Default plugin settings and synthetic data cannot reproduce every plugin migration, external service connection, disk condition, or Windows locale. Local import exercises the importer and startup used by the legacy pull; it does not test remote backup download. A successful trunk run does not rule out the original report. A trunk timeout followed by a verified draft startup within 300 seconds would support the proposed timeout increase for this fixture.
