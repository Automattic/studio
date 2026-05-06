# Native PHP Binaries

Studio currently downloads native PHP binaries on demand from the upstream
static-php-cli CDN. Custom Studio-built binaries are not bundled in the repo or
uploaded by PR CI.

Use the manual `Build PHP CLI Binaries` GitHub Actions workflow to build Studio
PHP CLI artifacts. The workflow checks out `crazywhalecc/static-php-cli`, pins
the requested SPC ref, passes Studio's extension list directly to `spc download`
and `spc build`, then uploads archives with `.sha256` sidecars.

The manual workflow currently builds:

- `php-8.4.20-cli-macos-aarch64.tar.gz`
- `php-8.4.20-cli-macos-x86_64.tar.gz`
- `php-8.4.20-cli-windows-x86_64.zip`

Windows ARM64 Studio builds use the Windows x64 PHP binary under Windows 11
emulation. Native Windows ARM64 PHP binaries are not built.

Do not patch `static-php-cli` by default. If the upstream build fails, use the
workflow logs to add the smallest targeted patch and document the exact upstream
failure that requires it.

Regular Studio app builds upload to the Apps CDN through `fastlane/Fastfile`:
`upload_file_to_apps_cdn` wraps `upload_build_to_apps_cdn` from
`fastlane-plugin-wpmreleasetoolkit`. That path requires `WPCOM_API_TOKEN`, the
Studio Apps CDN site ID, build metadata, and a file path. CDN upload for PHP
binary artifacts should be added separately after the manual GitHub Actions
builds are proven.
