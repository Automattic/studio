# Native PHP Binaries

Studio currently downloads native PHP binaries on demand from the upstream
static-php-cli CDN. Custom Studio-built binaries are not bundled in the repo or
uploaded by PR CI.

Use `npm run php-cli:build` to build macOS PHP 8.4.20 CLI artifacts with the
WordPress-recommended extension set plus Studio's SQLite/PDO runtime
requirements from `scripts/php-cli.craft.yml`. The script prepares
`static-php-cli`, then delegates the actual build to `spc craft`. It writes
`php-8.4.20-cli-macos-aarch64.tar.gz`,
`php-8.4.20-cli-macos-x86_64.tar.gz`, and their `.sha256` files to
`out/php-binaries/`.

Buildkite runs this build only when `scripts/build-php-cli.mjs` or
`scripts/php-cli.craft.yml` changed, and uploads the generated files as
Buildkite artifacts only.

Do not patch `static-php-cli` by default. If the upstream build fails, use the CI
logs to add the smallest targeted patch and document the exact upstream failure
that requires it.

Regular Studio app builds upload to the Apps CDN through `fastlane/Fastfile`:
`upload_file_to_apps_cdn` wraps `upload_build_to_apps_cdn` from
`fastlane-plugin-wpmreleasetoolkit`. That path requires `WPCOM_API_TOKEN`, the
Studio Apps CDN site ID, build metadata, and a file path. The PHP binary
Buildkite step passes `platform` and `arch` to `npm run php-cli:build` through a
matrix so future builds can add more platforms and architectures before a
separate Fastlane lane uploads the generated files.
