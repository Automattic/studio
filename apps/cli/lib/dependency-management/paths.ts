import path from 'path';
import {
	getConfiguredPhpBinaryPackageId,
	NativePhpSupportedVersions,
	type NativePhpSupportedVersion,
} from '@studio/common/lib/php-binary-metadata';
import { getConfigDirectory, getServerFilesPath } from '@studio/common/lib/well-known-paths';

const PHP_BINARY_FILENAME = process.platform === 'win32' ? 'php.exe' : 'php';
const MYSQLD_BINARY_FILENAME = process.platform === 'win32' ? 'mysqld.exe' : 'mysqld';
const MYSQLADMIN_BINARY_FILENAME = process.platform === 'win32' ? 'mysqladmin.exe' : 'mysqladmin';
const MYSQL_CLIENT_BINARY_FILENAME = process.platform === 'win32' ? 'mysql.exe' : 'mysql';

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

export function getMysqlBinaryRoot(): string {
	return path.join( getConfigDirectory(), 'mysql-bin' );
}

export function getMysqlInstallRoot( version: string ): string {
	return path.join( getMysqlBinaryRoot(), version );
}

export function getMysqlServerBinaryPath( version: string ): string {
	return path.join( getMysqlInstallRoot( version ), 'bin', MYSQLD_BINARY_FILENAME );
}

export function getMysqlAdminBinaryPath( version: string ): string {
	return path.join( getMysqlInstallRoot( version ), 'bin', MYSQLADMIN_BINARY_FILENAME );
}

export function getMysqlClientBinaryPath( version: string ): string {
	return path.join( getMysqlInstallRoot( version ), 'bin', MYSQL_CLIENT_BINARY_FILENAME );
}

export function getMysqlDataRoot(): string {
	return path.join( getConfigDirectory(), 'mysql-data' );
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

// The `php/` helper scripts ship alongside the bundled CLI code (`dist/cli/php`).
// Vite emits all chunks to the same output dir, so `import.meta.dirname` resolves
// to that directory from any module.
export function getWpConfigTransformerPath(): string {
	return path.join( import.meta.dirname, 'php', 'wp-config-transformer.php' );
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
