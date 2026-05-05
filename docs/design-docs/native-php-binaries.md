# Native PHP Binaries

Studio currently downloads native PHP binaries on demand from the upstream
static-php-cli CDN. Custom Studio-built binaries are not bundled in the repo or
uploaded by PR CI.

Use `npm run php-cli:build` to build the macOS arm64 PHP 8.4.20 CLI artifact
with the WordPress-recommended extension set plus Studio's SQLite/PDO runtime
requirements from `scripts/php-cli.craft.yml`. The script prepares
`static-php-cli`, then delegates the actual build to `spc craft`. It writes
`php-8.4.20-cli-macos-aarch64.tar.gz` and its `.sha256` file to
`out/php-binaries/`.

Buildkite runs this build only when the build script, craft config, or Buildkite
pipeline changes, and uploads the generated files as Buildkite artifacts only.

Do not patch `static-php-cli` by default. If the upstream build fails, use the CI
logs to add the smallest targeted patch and document the exact upstream failure
that requires it.

Regular Studio app builds upload to the Apps CDN through `fastlane/Fastfile`:
`upload_file_to_apps_cdn` wraps `upload_build_to_apps_cdn` from
`fastlane-plugin-wpmreleasetoolkit`. That path requires `WPCOM_API_TOKEN`, the
Studio Apps CDN site ID, build metadata, and a file path. The PHP binary
Buildkite step passes platform and architecture metadata to `npm run
php-cli:build` through a matrix so future builds can add more platforms and
architectures before a separate Fastlane lane uploads the generated files.
