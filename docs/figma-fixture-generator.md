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

## Temporary native-runtime integration evidence

This is an isolated macOS ARM integration check, not a public runtime selector or
default. The configured PHP metadata intentionally does not advertise `zstd`, so a
fresh CLI correctly rejects a Figma import before it downloads a runtime. To exercise
the normal `ensurePhpBinaryAvailable` path without changing that metadata, the command
below stages the exact workflow artifact where the configured `8.5.10-studio-1`
package normally lives. The existing staged binary makes `ensurePhpBinaryAvailable`
skip the capability-gated download, then it creates or synchronizes `php.ini`; the
Figma probe runs that binary with the generated INI.

The original tested SSI candidate was the full development ZIP from [SSI #1581](https://github.com/Automattic/static-site-importer/pull/1581), source commit [`165bf27363a0616c1c2ecb78c687e2bd2f05bc52`](https://github.com/Automattic/static-site-importer/commit/165bf27363a0616c1c2ecb78c687e2bd2f05bc52), named `static-site-importer-dev-165bf27363a0-blocks-engine-573e126b7fc1.zip`, with SHA-256 `7beec605fdc79885e84e6e29688c8aa3490c66847220ac7dca333ee8ece2f751`. It is candidate evidence only, not a release asset or configured default.

To build a reader-resolvable replacement, install `git`, Node.js, Composer, and the
`homeboy` CLI, then clone the two pinned source trees and run SSI's [development
package build contract](https://github.com/Automattic/static-site-importer/tree/165bf27363a0616c1c2ecb78c687e2bd2f05bc52#development-packages):

```sh
ssi_workdir="$( mktemp -d )"
git clone https://github.com/Automattic/static-site-importer.git "$ssi_workdir/static-site-importer"
git -C "$ssi_workdir/static-site-importer" checkout 165bf27363a0616c1c2ecb78c687e2bd2f05bc52
git clone https://github.com/Automattic/blocks-engine.git "$ssi_workdir/blocks-engine"
git -C "$ssi_workdir/blocks-engine" checkout 573e126b7fc1d95df757e183366384c2d72f691c
test "$( git -C "$ssi_workdir/static-site-importer" rev-parse HEAD )" = 165bf27363a0616c1c2ecb78c687e2bd2f05bc52
test "$( git -C "$ssi_workdir/blocks-engine" rev-parse HEAD )" = 573e126b7fc1d95df757e183366384c2d72f691c
test -z "$( git -C "$ssi_workdir/static-site-importer" status --porcelain )"
test -z "$( git -C "$ssi_workdir/blocks-engine" status --porcelain )"
(
	cd "$ssi_workdir/static-site-importer"
	npm run build:dev-package -- \
		--blocks-engine-path="$ssi_workdir/blocks-engine" \
		--blocks-engine-ref=573e126b7fc1d95df757e183366384c2d72f691c \
		--output-dir="$ssi_workdir/build"
)
SSI_CANDIDATE_ZIP="$ssi_workdir/build/static-site-importer-dev-165bf27363a0-blocks-engine-573e126b7fc1.zip"
test -f "$SSI_CANDIDATE_ZIP"
```

The build command creates an isolated snapshot, runs its pinned `composer update`
dependency step, and delegates ZIP assembly to `homeboy review build`; it does not
require a separate `npm install` in the SSI checkout. Keep `ssi_workdir` until the
integration check completes, then remove it with `rm -rf "$ssi_workdir"`.

The original tested ZIP's SHA-256 is useful only when that exact archive is supplied:

```sh
test "$( shasum -a 256 /path/to/static-site-importer-dev-165bf27363a0-blocks-engine-573e126b7fc1.zip | cut -d " " -f 1 )" = \
	7beec605fdc79885e84e6e29688c8aa3490c66847220ac7dca333ee8ece2f751
```

A local rebuild can have different archive bytes because ZIP assembly can preserve
timestamps. Do not claim it matches that historical checksum. Instead, verify the
clean source-tree commits above and the adjacent `$SSI_CANDIDATE_ZIP.json` provenance
receipt, which records SSI commit `165bf27363a0616c1c2ecb78c687e2bd2f05bc52` and
Blocks Engine commit `573e126b7fc1d95df757e183366384c2d72f691c`. Use the receipt's
recorded ZIP checksum for the locally rebuilt file.

From the Studio repository root, run:

```sh
# Set SSI_CANDIDATE_ZIP with the acquisition procedure above.
npm run cli:build
workdir="$( mktemp -d )"
trap 'rm -rf "$workdir"' EXIT
gh run download 34483685921 --repo Automattic/studio \
  --name php-8.5.10-cli-macos-aarch64 --dir "$workdir/artifact"
mkdir -p "$workdir/home/.studio/php-bin/8.5.10-studio-1"
unzip "$workdir/artifact/php-8.5.10-cli-macos-aarch64.zip" \
  -d "$workdir/home/.studio/php-bin/8.5.10-studio-1"
git clone https://github.com/Automattic/blocks-engine.git "$workdir/blocks-engine"
git -C "$workdir/blocks-engine" checkout 4f56d2dc29bc50d5d03285e5eb0f7e94029e7f1d
"$workdir/home/.studio/php-bin/8.5.10-studio-1/php" scripts/generate-figma-fixture.php \
  --blocks-engine-path="$workdir/blocks-engine/figma-transformer" \
  --output="$workdir/studio-fixture.fig"
HOME="$workdir/home" node apps/cli/dist/cli/main.mjs create \
  --from="$workdir/studio-fixture.fig" \
  --static-site-importer-path="$SSI_CANDIDATE_ZIP" \
  --runtime=native --php=8.5 \
  --name='Studio Fixture' --path="$workdir/studio-figma-fixture" --no-start
test -f "$workdir/home/.studio/php-bin/8.5.10-studio-1/php.ini"
```

The PHP artifact is [workflow run 34483685921](https://github.com/Automattic/studio/actions/runs/34483685921), [job 102892497452](https://github.com/Automattic/studio/actions/runs/34483685921/job/102892497452), artifact `10155344620` (`php-8.5.10-cli-macos-aarch64`). The trap removes the isolated `HOME`, staged runtime, fixture, and imported site after the command exits.

The workflow verifies both `zstd` loading and `zstd_uncompress`. This fixture exercises
only fixture generation and the opaque Figma request/staging/import path. It does not
establish production fidelity or editability.
