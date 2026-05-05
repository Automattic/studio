# Native PHP Binaries

Studio currently downloads native PHP binaries on demand from the upstream
static-php-cli CDN. Custom Studio-built binaries are not bundled in the repo or
uploaded by PR CI.

Use `.buildkite/commands/run-php-cli-macos-arm64-build.sh` to build the macOS
arm64 PHP 8.4.20 CLI artifact with the WordPress-recommended extension set plus
Studio's SQLite/PDO runtime requirements from `scripts/php-cli.craft.yml`. The
script writes `php-8.4.20-cli-macos-aarch64.tar.gz` and its `.sha256` file to
`out/php-binaries/`.

Buildkite runs this build only when the craft config, static-php-cli patch, or
CI wrapper changes, and uploads the generated files as Buildkite artifacts only.

The static-php-cli patch is temporary for 2.8.5 macOS arm64 builds: it maps
CMake's Apple Silicon architecture to `arm64` and removes stale `-lstdc++`
entries from C++ library link flags so the final PHP binary links against
`libc++`.

Regular Studio app builds upload to the Apps CDN through `fastlane/Fastfile`:
`upload_file_to_apps_cdn` wraps `upload_build_to_apps_cdn` from
`fastlane-plugin-wpmreleasetoolkit`. That path requires `WPCOM_API_TOKEN`, the
Studio Apps CDN site ID, build metadata, and a file path. A future PHP binary
upload should be a separate manual Fastlane lane, dry-run by default, and should
not run from PR CI.
