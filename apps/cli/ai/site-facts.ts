import path from 'path';
import { formatSavedCopies, readSavedCopies } from 'cli/ai/saved-overrides';
import { getWordPressVersionFromInstallation } from 'cli/lib/dependency-management/wordpress';
import type { SiteInfo } from 'cli/ai/types';

/**
 * Facts about a local site read from its own files and database, one line
 * each, for the Active site section: the WordPress it runs, where that
 * WordPress declares its block types, and the copies saved in the Site Editor.
 */
export async function readActiveSiteFacts( site?: SiteInfo | null ): Promise< string[] > {
	if ( ! site || site.remote ) {
		return [];
	}
	const [ version, savedCopies ] = await Promise.all( [
		getWordPressVersionFromInstallation( site.path ),
		readSavedCopies( site.path ),
	] );
	const blocks = path.join( site.path, 'wp-includes', 'blocks' ).split( path.sep ).join( '/' );
	return [
		version
			? `WordPress ${ version }. Its core block types, with their attributes and supports, are declared in ${ blocks }/<block>/block.json.`
			: undefined,
		formatSavedCopies( savedCopies ),
	].filter( ( fact ): fact is string => Boolean( fact ) );
}
