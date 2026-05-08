# Native PHP Binaries

Use the manual `Build PHP CLI Binaries` GitHub Actions workflow to build Studio
PHP CLI artifacts. The workflow checks out `crazywhalecc/static-php-cli`, pins
the requested SPC ref, passes Studio's extension list directly to `spc download`
and `spc build`, then builds archives with `.sha256` sidecars.

The manual workflow currently builds:

- `php-8.4.20-cli-macos-aarch64.zip`
- `php-8.4.20-cli-macos-x86_64.zip`
- `php-8.4.20-cli-windows-x86_64.zip`

Windows ARM64 Studio builds use the Windows x64 PHP binary under Windows 11
emulation. Native Windows ARM64 PHP binaries are not built.

The publish job verifies each downloaded archive against its `.sha256` sidecar
before upload. Apps CDN stores the same checksum in the generated manifest for
the separate `WordPress.com Studio PHP CLI` product:

`https://appscdn.wordpress.com/builds/wordpress-com-studio-php-cli/releases.json`

For internal Studio validation, the workflow can upload the unsigned `.zip`
archives directly to Apps CDN:

1. Run the manual GitHub Actions `Build PHP CLI Binaries` workflow.
2. Keep `upload_to_apps_cdn` disabled for lane validation, or enable it for an
   Apps CDN upload.
3. Set `apps_cdn_visibility` to `internal` for internal testing or
   `external` for public publishing.

After the three build jobs finish, GitHub Actions downloads the workflow
artifacts and calls:

```sh
bundle exec fastlane publish_php_cli_binaries \
  version:"${PHP_VERSION}" \
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
DRY_RUN=true bundle exec fastlane publish_php_cli_binaries version:8.4.20 artifacts_dir:out/php-binaries
bundle exec fastlane publish_php_cli_binaries version:8.4.20 artifacts_dir:out/php-binaries visibility:external
```

The lane publishes the existing archive filenames without renaming them, reads
the corresponding `.sha256` sidecars into the Apps CDN `sha` field, and uploads
them as:

- product: `WordPress.com Studio PHP CLI`
- resource type: `Build` (set by the release toolkit upload action)
- build type: `Production`
- install type: `Full Install`
- platform: `Mac - Silicon`, `Mac - Intel`, or `Windows - x64`
