import path from 'path';
import { extractZip } from '@studio/common/lib/extract-zip';
import { pathExists } from '@studio/common/lib/fs-utils';
import { WP_LOCALES } from '@studio/common/lib/wp-locales';
import { getLanguagePacksPath } from 'cli/lib/dependency-management/paths';

/**
 * Unpacks the bundled WordPress language pack for a given locale into a site's
 * wp-content/languages/ directory, including core, plugin, and theme translations.
 * Returns true if a language pack was installed.
 */
export async function copyLanguagePackToSite(
	sitePath: string,
	wpLocale: string
): Promise< boolean > {
	// Translations are only bundled for `WP_LOCALES`.
	if ( ! WP_LOCALES.includes( wpLocale ) ) {
		return false;
	}

	const zipPath = path.join( getLanguagePacksPath(), `${ wpLocale }.zip` );
	if ( ! ( await pathExists( zipPath ) ) ) {
		return false;
	}

	await extractZip( zipPath, path.join( sitePath, 'wp-content', 'languages' ) );
	return true;
}
