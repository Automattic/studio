# Native PHP Binaries

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

The `.sha256` sidecars are used to verify downloaded artifacts. When these
artifacts are published to the Apps CDN, copy those checksums into
`tools/common/lib/php-binary-metadata.ts`.
Before publishing macOS artifacts, sign and notarize the `php` binary with the
existing Studio Developer ID setup.

Regular Studio app builds upload to the Apps CDN through `fastlane/Fastfile`:
`upload_file_to_apps_cdn` wraps `upload_build_to_apps_cdn` from
`fastlane-plugin-wpmreleasetoolkit`. That path requires `WPCOM_API_TOKEN`, the
Studio Apps CDN site ID, build metadata, and a file path. CDN upload for PHP
binary artifacts should be added separately after the manual GitHub Actions
builds are proven.
