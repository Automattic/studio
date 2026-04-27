import path from 'path';
import { getServerFilesPath } from '@studio/common/lib/well-known-paths';

// PHP binary location — downloaded via `npm run download:php-binary` for local dev.
// Not bundled in production builds; this path will be undefined in packaged Studio/CLI.
const PHP_BINARY_FILENAME = process.platform === 'win32' ? 'php.exe' : 'php';

export function getPhpBinaryPath(): string {
	return path.join( import.meta.dirname, '..', '..', 'bin', PHP_BINARY_FILENAME );
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
