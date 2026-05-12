import fs from 'fs';
import path from 'path';
import {
	comparePhpPatchVersionsDescending,
	isPhpPatchVersionForMinor,
	NativePhpSupportedVersion,
	parsePhpPatchVersion,
} from '@studio/common/lib/php-binary-metadata';
import { getConfigDirectory, getServerFilesPath } from '@studio/common/lib/well-known-paths';

const PHP_BINARY_FILENAME = process.platform === 'win32' ? 'php.exe' : 'php';

function getPhpBinaryRoot(): string {
	return path.join( getConfigDirectory(), 'php-bin' );
}

function getExactPhpBinaryPath( version: string ): string {
	return path.join( getPhpBinaryRoot(), version, PHP_BINARY_FILENAME );
}

export function getInstalledPhpBinaryPath(
	version: NativePhpSupportedVersion
): string | undefined {
	const phpBinRoot = getPhpBinaryRoot();
	if ( ! fs.existsSync( phpBinRoot ) ) {
		return undefined;
	}

	const patchVersion = fs
		.readdirSync( phpBinRoot, { withFileTypes: true } )
		.filter( ( entry ) => entry.isDirectory() && isPhpPatchVersionForMinor( entry.name, version ) )
		.map( ( entry ) => entry.name )
		.sort( comparePhpPatchVersionsDescending )
		.find( ( candidate ) => fs.existsSync( getExactPhpBinaryPath( candidate ) ) );

	return patchVersion ? getExactPhpBinaryPath( patchVersion ) : undefined;
}

// PHP binaries live in ~/.studio/php-bin/<patch>/ — downloaded on demand when a site
// using that minor version is first started. Not bundled in production builds.
export function getPhpBinaryPath( version: NativePhpSupportedVersion | string ): string {
	if ( parsePhpPatchVersion( version ) ) {
		return getExactPhpBinaryPath( version );
	}

	return (
		getInstalledPhpBinaryPath( version as NativePhpSupportedVersion ) ??
		getExactPhpBinaryPath( version )
	);
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

export function getLanguagePacksPath(): string {
	return path.join( getServerFilesPath(), 'language-packs' );
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
