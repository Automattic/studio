# Native PHP Binaries

Studio currently downloads native PHP binaries on demand from the upstream
static-php-cli CDN. Custom Studio-built binaries are not bundled in the repo or
uploaded by PR CI.

Use `npm run php-cli:build` to build PHP 8.4.20 CLI artifacts with the
WordPress-recommended extension set plus Studio's SQLite/PDO runtime
requirements. macOS uses `scripts/php-cli.craft.yml`; Windows uses
`scripts/php-cli.windows.craft.yml` because SPC does not support every Unix
extension there. The script prepares `static-php-cli`, then delegates the actual
build to `spc craft`. It writes
`php-8.4.20-cli-macos-aarch64.tar.gz`,
`php-8.4.20-cli-windows-x86_64.zip`, and their `.sha256` files to
`out/php-binaries/`.

Buildkite runs this build only when `scripts/build-php-cli.mjs` or
one of the checked-in PHP CLI craft files changed, and uploads the generated
files as Buildkite artifacts only.

SPC 2.8.5 does not support macOS cross-compilation. Buildkite only builds the
macOS ARM64 artifact until an Intel macOS agent or fully x64 Rosetta build
environment is available for `php-8.4.20-cli-macos-x86_64.tar.gz`.

Windows builds require a Visual Studio C++ toolchain. The build script installs
Visual Studio 2022 Build Tools when the Windows agent does not already have a
supported Visual Studio installation or CMake. SPC 2.8.5 checks Community,
Professional, and Enterprise install paths but not all Build Tools paths, so the
script uses `vswhere` to find the actual MSBuild location and applies a
Windows-only source edit after checkout to let SPC detect it.

SPC 2.8.5 also fails to extract `php-src` on the Windows Buildkite agent because
its `7za | tar -C <source>\php-src` command runs before `<source>\php-src`
exists. The script creates that Windows source extraction target before running
`spc craft` and patches the Windows `tar -C` target to use forward slashes.

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
