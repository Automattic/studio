# Figma Fixture Generator

This repository does not store binary Figma fixtures. Generate the small, synthetic
fixture used to exercise Studio's staged Figma request with the exact upstream Blocks
Engine test helper instead.

Requirements:

- The macOS ARM PHP artifact from [job 102892497452](https://github.com/Automattic/studio/actions/runs/34483685921/job/102892497452), artifact `10155344620`, which is not published and must be downloaded from the workflow.
- PHP 8.2 or newer with `zip` and `zstd` extensions.
- A checkout of [Blocks Engine](https://github.com/Automattic/blocks-engine) at
  `4f56d2dc29bc50d5d03285e5eb0f7e94029e7f1d` or a revision that retains
  `figma-transformer/tests/contract/SyntheticFigKiwiFixtureBuilder.php`.

```sh
workdir="$( mktemp -d )"
gh run download 34483685921 --repo Automattic/studio --name php-8.5.10-cli-macos-aarch64 --dir "$workdir/artifact"
unzip "$workdir/artifact/php-8.5.10-cli-macos-aarch64.zip" -d "$workdir/php"
git clone https://github.com/Automattic/blocks-engine.git "$workdir/blocks-engine"
git -C "$workdir/blocks-engine" checkout 4f56d2dc29bc50d5d03285e5eb0f7e94029e7f1d
"$workdir/php/php" scripts/generate-figma-fixture.php \
	--blocks-engine-path="$workdir/blocks-engine/figma-transformer" \
	--output="$workdir/studio-fixture.fig"
unzip -t "$workdir/studio-fixture.fig"
```

The generator calls `SyntheticFigKiwiFixtureBuilder` to create a `.fig` archive with
a `fig-kiwi` canvas, a zlib JSON node-change chunk, and an actual zstd chunk. It does
not fabricate arbitrary bytes. The generator normalizes ZIP entry timestamps after
the upstream helper writes the archive so identical inputs produce a reproducible
fixture.

The repository integration test uses the same command and can run against an
explicit PHP runtime with zstd:

```sh
BLOCKS_ENGINE_FIGMA_TRANSFORMER_PATH="$workdir/blocks-engine/figma-transformer" \
PHP_BINARY_WITH_ZSTD="$workdir/php/php" \
npm test -- scripts/generate-figma-fixture.test.mjs
```

To exercise Studio's source request and staging path with the SSI #1581 candidate:

```sh
SSI_CANDIDATE_ZIP=/absolute/path/to/static-site-importer-dev-165bf27363a0-blocks-engine-573e126b7fc1.zip
cp "$SSI_CANDIDATE_ZIP" "$workdir/static-site-importer.zip"
npm run cli:build
node apps/cli/dist/cli/main.mjs create \
  --from="$workdir/studio-fixture.fig" \
  --static-site-importer-path="$workdir/static-site-importer.zip" \
  --runtime=native \
  --name='Studio Fixture' --path="$workdir/studio-figma-fixture" --no-start
```

Set `$workdir/static-site-importer.zip` to the archive built from SSI #1581 at
`aa7ee1ba9b36f5f3245c0471ff73d72c8d8c40f1`. The release asset remains unverified,
so it is deliberately not configured as a default package. The workflow verifies both
`zstd` loading and `zstd_uncompress`. This fixture exercises only fixture generation
and the opaque Figma request/staging/import path.
