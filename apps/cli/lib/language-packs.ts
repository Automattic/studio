import fs from 'fs';
import path from 'path';
import { pathExists } from '@studio/common/lib/fs-utils';
import { WP_LOCALES } from '@studio/common/lib/wp-locales';
import { getLanguagePacksPath } from 'cli/lib/dependency-management/paths';

/**
 * Filters files in a directory that match a given WordPress locale.
 * Matches .l10n.php files ({locale}.l10n.php, {domain}-{locale}.l10n.php)
 * and .json files ({locale}-{hash}.json).
 */
function filterLocaleFiles( files: string[], wpLocale: string ): string[] {
	return files.filter( ( file ) => {
		const name = path.basename( file );
		return (
			name === `${ wpLocale }.l10n.php` ||
			name.endsWith( `-${ wpLocale }.l10n.php` ) ||
			( name.startsWith( `${ wpLocale }-` ) && name.endsWith( '.json' ) )
		);
	} );
}

/**
 * Copies matching locale files from a source directory to a destination directory.
 */
async function copyLocaleFiles(
	sourceDir: string,
	destDir: string,
	wpLocale: string
): Promise< number > {
	if ( ! ( await pathExists( sourceDir ) ) ) {
		return 0;
	}
	const allFiles = await fs.promises.readdir( sourceDir );
	const localeFiles = filterLocaleFiles( allFiles, wpLocale );
	if ( localeFiles.length === 0 ) {
		return 0;
	}
	await fs.promises.mkdir( destDir, { recursive: true } );
	for ( const file of localeFiles ) {
		await fs.promises.copyFile( path.join( sourceDir, file ), path.join( destDir, file ) );
	}
	return localeFiles.length;
}

/**
 * Copies bundled WordPress language pack files for a given locale into a site's
 * wp-content/languages/ directory, including core, plugin, and theme translations.
 * Returns true if files were copied successfully.
 */
export async function copyLanguagePackToSite(
	sitePath: string,
	wpLocale: string
): Promise< boolean > {
	// Translations are only bundled for `WP_LOCALES`; skip the readdir() calls over the
	// ~1,400-entry bundled languages directories when no files could match anyway.
	if ( ! WP_LOCALES.includes( wpLocale ) ) {
		return false;
	}

	const languagePacksDir = getLanguagePacksPath();
	if ( ! ( await pathExists( languagePacksDir ) ) ) {
		return false;
	}

	const destBase = path.join( sitePath, 'wp-content', 'languages' );

	let totalCopied = 0;
	totalCopied += await copyLocaleFiles( languagePacksDir, destBase, wpLocale );
	totalCopied += await copyLocaleFiles(
		path.join( languagePacksDir, 'plugins' ),
		path.join( destBase, 'plugins' ),
		wpLocale
	);
	totalCopied += await copyLocaleFiles(
		path.join( languagePacksDir, 'themes' ),
		path.join( destBase, 'themes' ),
		wpLocale
	);

	return totalCopied > 0;
}
