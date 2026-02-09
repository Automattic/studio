import fs from 'fs';
import path from 'path';
import { pathExists } from 'common/lib/fs-utils';
import { getLanguagePacksPath } from 'cli/lib/server-files';

/**
 * Copies bundled WordPress core language pack files for a given locale into a site's
 * wp-content/languages/ directory. Returns true if files were copied successfully.
 */
export async function copyLanguagePackToSite(
	sitePath: string,
	wpLocale: string
): Promise< boolean > {
	const languagePacksDir = getLanguagePacksPath();
	if ( ! ( await pathExists( languagePacksDir ) ) ) {
		return false;
	}

	// Language pack files follow WordPress naming conventions.
	// We only bundle .l10n.php and .json files (WordPress 6.5+ format).
	// .l10n.php: {locale}.l10n.php, {domain}-{locale}.l10n.php
	// .json: {locale}-{hash}.json
	const allFiles = await fs.promises.readdir( languagePacksDir );
	const localeFiles = allFiles.filter( ( file ) => {
		const name = path.basename( file );
		return (
			name === `${ wpLocale }.l10n.php` ||
			name.endsWith( `-${ wpLocale }.l10n.php` ) ||
			( name.startsWith( `${ wpLocale }-` ) && name.endsWith( '.json' ) )
		);
	} );

	if ( localeFiles.length === 0 ) {
		return false;
	}

	const destDir = path.join( sitePath, 'wp-content', 'languages' );
	await fs.promises.mkdir( destDir, { recursive: true } );

	for ( const file of localeFiles ) {
		await fs.promises.copyFile( path.join( languagePacksDir, file ), path.join( destDir, file ) );
	}

	return true;
}
