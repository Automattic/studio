# Figma Fixture Generator

This repository does not store binary Figma fixtures. Generate the small, synthetic
fixture used to exercise Studio's staged Figma request with the exact upstream Blocks
Engine test helper instead.

Requirements:

- PHP 8.2 or newer with `zip` and `zstd` extensions.
- A checkout of [Blocks Engine](https://github.com/Automattic/blocks-engine) at
  `4f56d2dc29bc50d5d03285e5eb0f7e94029e7f1d` or a revision that retains
  `figma-transformer/tests/contract/SyntheticFigKiwiFixtureBuilder.php`.

```sh
git clone https://github.com/Automattic/blocks-engine.git /tmp/blocks-engine
git -C /tmp/blocks-engine checkout 4f56d2dc29bc50d5d03285e5eb0f7e94029e7f1d
php scripts/generate-figma-fixture.php \
  --blocks-engine-path=/tmp/blocks-engine/figma-transformer \
  --output=/tmp/studio-fixture.fig
unzip -t /tmp/studio-fixture.fig
```

The generator calls `SyntheticFigKiwiFixtureBuilder` to create a `.fig` archive with
a `fig-kiwi` canvas, a zlib JSON node-change chunk, and an actual zstd chunk. It does
not fabricate arbitrary bytes. The generator normalizes ZIP entry timestamps after
the upstream helper writes the archive so identical inputs produce a reproducible
fixture.

The repository integration test uses the same command and can run against an
explicit PHP runtime with zstd:

```sh
BLOCKS_ENGINE_FIGMA_TRANSFORMER_PATH=/tmp/blocks-engine/figma-transformer \
PHP_BINARY_WITH_ZSTD=/path/to/php \
npm test -- scripts/generate-figma-fixture.test.mjs
```

To exercise Studio's source request and staging path with the SSI #1581 candidate:

```sh
npm run cli:build
node apps/cli/dist/cli/main.mjs create \
  --from=/tmp/studio-fixture.fig \
  --static-site-importer-path=/path/to/static-site-importer-candidate.zip \
  --name='Studio Fixture' --path=/tmp/studio-figma-fixture --no-start
```

Use a native PHP artifact whose `runtime.json` has `"capabilities":["zstd"]`; the
workflow verifies both `zstd` loading and `zstd_uncompress`. This fixture proves only
fixture generation plus the opaque Figma request/staging/import path. Observed output
is Gutenberg markup, not a production-design fidelity or editability claim.
