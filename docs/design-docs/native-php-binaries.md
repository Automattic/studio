# Native PHP Binaries

Use the manual `Build PHP CLI Binaries` GitHub Actions workflow to build Studio
PHP CLI artifacts. The two platforms use different build strategies because
static-php-cli only supports shared extensions on Unix-like targets:

- **macOS** checks out `crazywhalecc/static-php-cli`, pins the requested SPC
  ref, and runs `spc build "$extensions" --build-shared=xdebug --build-cli`.
  Every extension lives inside the `php` binary; Xdebug ships as the only
  loadable `.so` under `ext/` because it's a Zend extension that has to dlopen
  at startup.
- **Windows** downloads the matching `windows.php.net` prebuilt PHP, overlays
  the Xdebug DLL from `xdebug.org`, and fetches each missing PECL extension
  (apcu, igbinary, redis, ssh2, yaml) from `downloads.php.net/~windows/pecl`
  with the newest published version that has a build for the requested
  `PHP_MINOR` + VS toolchain. It also copies the matching x64 VC143 runtime
  from the Visual Studio 2022 runner beside `php.exe`, so the package does not
  depend on a machine-wide Visual C++ Redistributable installation.

The artifact shapes diverge as a result: the macOS `ext/` directory contains
only `xdebug.so`, while the Windows `ext/` directory contains a
`php_<name>.dll` for every non-built-in extension. Both archives still expose
a stable `runtime.json` manifest with `phpVersion`, `extensionDir`, and
`xdebug` paths. The manifest also records `packageVersion`, the required
engineer-chosen immutable packaging identifier, and `packageId`, its
PHP-qualified CDN and local-directory identifier. All artifacts ship with
`.sha256` sidecars.

The Studio consumer needs to know this divergence when launching the binary:
on macOS the baked-in extensions are implicit and need no `extension=…` flags,
while on Windows it must pass `-d extension_dir=ext -d extension=<name>` for
each extension it wants enabled. Xdebug is loaded the same way on both
platforms: `-d zend_extension=ext/xdebug.so` (macOS) or
`-d zend_extension=ext/php_xdebug.dll` (Windows).

The manual workflow currently builds:

- `php-<patch>-cli-macos-aarch64.zip`
- `php-<patch>-cli-macos-x86_64.zip`
- `php-<patch>-cli-windows-x86_64.zip`

Windows ARM64 Studio builds use the Windows x64 PHP binary under Windows 11
emulation. Native Windows ARM64 PHP binaries are not built.

The publish job verifies each downloaded archive against its `.sha256` sidecar
before upload. Apps CDN stores the same checksum for the separate
`WordPress.com Studio PHP CLI` product; the Studio runtime consumes the
checked-in metadata file described below.

For internal Studio validation, the workflow can upload the unsigned `.zip`
archives directly to Apps CDN:

1. Run the manual GitHub Actions `Build PHP CLI Binaries` workflow.
2. Set `package_version` to an immutable identifier. It defaults to `studio-1`
   and does not need to be SemVer. Choose a new value whenever rebuilding the
   same upstream PHP release.
3. Set `apps_cdn_visibility` to `none` to skip the upload (lane validation
   only), `internal` for internal testing, or `external` for public
   publishing.

After the three build jobs finish, GitHub Actions downloads the workflow
artifacts and calls:

```sh
bundle exec fastlane publish_php_cli_binaries \
  version:"${PHP_VERSION}" \
  package_version:"${PHP_PACKAGE_VERSION}" \
  artifacts_dir:"${PWD}/out/php-binaries" \
  visibility:"${PHP_CLI_VISIBILITY:-internal}"
```

Regular Studio app builds upload to the Apps CDN through `fastlane/Fastfile`:
`upload_file_to_apps_cdn` wraps `upload_build_to_apps_cdn` from
`fastlane-plugin-wpmreleasetoolkit`. That path requires `WPCOM_API_TOKEN`, the
Studio Apps CDN site ID, build metadata, and a file path.

PHP CLI artifacts use a separate lane so they do not look like Studio app
builds:

```sh
DRY_RUN=true bundle exec fastlane publish_php_cli_binaries version:8.4.20 package_version:1.0.0 artifacts_dir:out/php-binaries
bundle exec fastlane publish_php_cli_binaries version:8.4.20 package_version:1.0.0 artifacts_dir:out/php-binaries visibility:external
```

The lane publishes the existing archive filenames without renaming them, reads
the corresponding `.sha256` sidecars into the Apps CDN `sha` field, and uploads
them as:

- product: `WordPress.com Studio PHP CLI`
- resource type: `Build` (set by the release toolkit upload action)
- build type: `Production`
- install type: `Full Install`
- platform: `Mac - Silicon`, `Mac - Intel`, or `Windows - x64`

PHP CLI package identifiers are immutable. Duplicate uploads fail rather than
replacing an existing Apps CDN artifact, because released Studio versions
retain that artifact's URL and SHA-256. Replacing its bytes would cause
checksum failures in those installations.

After a successful Apps CDN upload, the workflow updates
`packages/common/lib/php-binary-cdn-metadata.json` and opens a PR with the new CDN
URLs and SHA-256 hashes. The metadata keeps one patch version per PHP minor
version and may include a separate `packageVersion`. A different package
identifier changes both the Apps CDN URL and local installation directory
without pretending that upstream PHP published another patch.

At runtime, Studio uses `packages/common/lib/php-binary-cdn-metadata.json` as the
source of truth for the requested PHP minor version. Packaged Studio builds
ship the recommended PHP version under the app resources
`php-bin/<package-id>/`;
a CLI migration copies that directory into the writable install location if the
destination package folder does not exist. Studio downloads other PHP versions
on demand from manifest URLs, then verifies the checked-in SHA-256 before
extracting the archive. If metadata is missing for the requested device, native
PHP install fails for that version.

Downloaded binaries are installed under
`~/.studio/php-bin/<package-id>/`, for example
`~/.studio/php-bin/8.4.20-studio-1/php`. Metadata without a `packageVersion`
falls back to the PHP patch for backward compatibility. This lets Studio
download either a new PHP patch or a new packaging revision without replacing
a binary that an existing native PHP process is still using.

Apps CDN PHP CLI artifacts are ZIP files for macOS and Windows.
