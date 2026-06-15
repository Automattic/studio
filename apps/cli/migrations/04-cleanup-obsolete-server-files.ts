/**
 * Removes server-files entries that are now read directly from the CLI's
 * bundled `wp-files/` directory and no longer need a writable cache:
 *   - `skills/` (AI instructions)
 *   - `sqlite-database-integration/` (SQLite plugin)
 *   - `sqlite-command/` (SQLite command)
 *   - `phpmyadmin/` (phpMyAdmin)
 *   - `wp-cli.phar` (WP-CLI)
 *   - `wordpress-versions/latest/available-site-translations.json`
 *   - `language-packs/` (WordPress translations, plus its lockfile)
 *
 * Safe to re-run: `needsToRun()` checks for the presence of any obsolete
 * entry, and `run()` tolerates missing paths.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getServerFilesPath } from '@studio/common/lib/well-known-paths';
import type { Migration } from '@studio/common/lib/migration';

function getObsoletePaths(): string[] {
	const serverFilesPath = getServerFilesPath();
	return [
		path.join( serverFilesPath, 'skills' ),
		path.join( serverFilesPath, 'sqlite-database-integration' ),
		path.join( serverFilesPath, 'sqlite-command' ),
		path.join( serverFilesPath, 'phpmyadmin' ),
		path.join( serverFilesPath, 'wp-cli.phar' ),
		path.join(
			serverFilesPath,
			'wordpress-versions',
			'latest',
			'available-site-translations.json'
		),
		path.join( serverFilesPath, 'language-packs' ),
		path.join( serverFilesPath, 'language-packs.lock' ),
	];
}

export const cleanupObsoleteServerFiles: Migration = {
	needsToRun: async () => {
		return getObsoletePaths().some( ( p ) => fs.existsSync( p ) );
	},
	run: async () => {
		for ( const p of getObsoletePaths() ) {
			await fs.promises.rm( p, { recursive: true, force: true } );
		}
	},
};
