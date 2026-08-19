import path from 'path';
import {
	getConfiguredPhpBinaryPackageId,
	NativePhpSupportedVersions,
	type NativePhpSupportedVersion,
} from '@studio/common/lib/php-binary-metadata';
import { getConfigDirectory, getServerFilesPath } from '@studio/common/lib/well-known-paths';

const PHP_BINARY_FILENAME = process.platform === 'win32' ? 'php.exe' : 'php';

function getPhpBinaryRoot(): string {
	return path.join( getConfigDirectory(), 'php-bin' );
}

function getExactPhpBinaryPath( version: string ): string {
	return path.join( getPhpBinaryRoot(), version, PHP_BINARY_FILENAME );
}

function isNativePhpSupportedVersion( version: string ): version is NativePhpSupportedVersion {
	return ( NativePhpSupportedVersions as readonly string[] ).includes( version );
}

// PHP binaries live in ~/.studio/php-bin/<package-id>/. The default version also ships with
// Studio and is copied into this writable location by a CLI migration.
export function getPhpBinaryPath( version: NativePhpSupportedVersion | string ): string {
	if ( ! isNativePhpSupportedVersion( version ) ) {
		return getExactPhpBinaryPath( version );
	}

	const packageId = getConfiguredPhpBinaryPackageId( version );
	return getExactPhpBinaryPath( packageId ?? version );
}

const WP_CLI_PHAR_FILENAME = 'wp-cli.phar';
const SQLITE_COMMAND_DIRNAME = 'sqlite-command';

// The `wp-files` directory ships alongside the bundled CLI code (`dist/cli/wp-files`). Vite
// emits all chunks to the same output dir so `import.meta.dirname` works from any module.
export function getWpFilesPath(): string {
	return path.join( import.meta.dirname, 'wp-files' );
}

export function getWordPressVersionPath( version: string ): string {
	return path.join( getServerFilesPath(), 'wordpress-versions', version );
}

// reprint.phar ships read-only with the CLI bundle (downloaded into `wp-files` at build time) and is
// mounted into the PHP-wasm VFS at `/tmp/reprint.phar` by the reprint child process.
export function getReprintPharPath(): string {
	return path.join( getWpFilesPath(), 'reprint', 'reprint.phar' );
}

// WP-CLI ships read-only with the CLI bundle and is mounted into the PHP-wasm VFS at
// `/tmp/wp-cli.phar`. No writable cache needed.
export function getWpCliPharPath(): string {
	return path.join( getWpFilesPath(), 'wp-cli', WP_CLI_PHAR_FILENAME );
}

// SQLite command ships read-only with the CLI bundle and is mounted into the PHP-wasm
// VFS at `/tmp/sqlite-command`. No writable cache needed.
export function getSqliteCommandPath(): string {
	return path.join( getWpFilesPath(), SQLITE_COMMAND_DIRNAME );
}

// Language packs ship read-only with the CLI bundle and are copied into each site's
// `wp-content/languages/` directory on site create. No writable cache needed.
export function getLanguagePacksPath(): string {
	return path.join( getWpFilesPath(), 'latest', 'languages' );
}

// AI instructions ship read-only with the CLI bundle and are installed into each site's
// `.agents/skills/` directory on site create/start. No writable cache needed — the bundled
// directory is treated as the source of truth.
export function getAiInstructionsPath(): string {
	return path.join( getWpFilesPath(), 'skills' );
}

// phpMyAdmin ships read-only with the CLI bundle and is mounted into the PHP-wasm VFS at
// `/tools/phpmyadmin`. No writable cache needed.
export function getPhpMyAdminPath(): string {
	return path.join( getWpFilesPath(), 'phpmyadmin' );
}

export function getBlueprintsPharPath(): string {
	return path.join( getWpFilesPath(), 'blueprints', 'blueprints.phar' );
}

// Studio's own PHP helper scripts ship read-only with the CLI bundle under
// `dist/cli/php` (copied from `apps/cli/php` at build time by the `write-dist-extras`
// vite plugin). `import.meta.dirname` resolves to the bundle output dir.
function getBundledPhpPath(): string {
	return path.join( import.meta.dirname, 'php' );
}

// PHP driver that imports a WordPress export (WXR) file via the wordpress-importer plugin.
export function getBundledWxrImportScriptPath(): string {
	return path.join( getBundledPhpPath(), 'import-wxr.php' );
}

// The official wordpress-importer plugin, downloaded into `wp-files/` at install time via the
// `FILES_TO_DOWNLOAD` registry in `scripts/download-wp-server-files.ts` and shipped in the CLI
// bundle. Installed into the site's `wp-content/plugins` before running a WXR import so the
// import works offline.
export function getBundledWordPressImporterPath(): string {
	return path.join( getWpFilesPath(), 'wordpress-importer' );
}

export function getBundledStaticSiteImporterPath(): string {
	return path.join( getWpFilesPath(), 'static-site-importer' );
}
