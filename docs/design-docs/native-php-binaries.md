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

The `.sha256` sidecars are used to verify downloaded artifacts. Studio first
checks the Apps CDN manifest for the separate `WordPress.com Studio PHP CLI`
product:

`https://appscdn.wordpress.com/builds/wordpress-com-studio-php-cli/releases.json`

If the manifest has a matching URL and SHA for the requested PHP patch version,
platform, and architecture, Studio downloads that archive. Otherwise the native
PHP install fails; Apps CDN is the source of truth for these binaries.

Apps CDN archives can be `.zip` or `.tar.gz`; Studio picks the extractor from
the archive extension. Current signed Apps CDN artifacts are ZIP files for macOS
and Windows.
