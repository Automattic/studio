import { getWordPressVersionFromInstallation } from 'cli/lib/dependency-management/wordpress';
import type { SiteInfo } from 'cli/ai/types';

/**
 * Facts about a local site read from its own files, one line each, for the
 * Active site section: the WordPress version it runs.
 */
export async function readActiveSiteFacts( site?: SiteInfo | null ): Promise< string[] > {
	if ( ! site || site.remote ) {
		return [];
	}
	const version = await getWordPressVersionFromInstallation( site.path );
	return version ? [ `WordPress ${ version }.` ] : [];
}
