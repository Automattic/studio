import { describeWpcomSiteCapabilities, getWpcomSiteCapabilities } from 'cli/ai/wpcom-capabilities';
import { getWordPressVersionFromInstallation } from 'cli/lib/dependency-management/wordpress';
import type { SiteInfo } from 'cli/ai/types';

/**
 * Facts about the active site, one line each, for the Active site section:
 * the WordPress version a local site runs, and what a WordPress.com site's
 * plan and the user's role allow.
 */
export async function readActiveSiteFacts( site?: SiteInfo | null ): Promise< string[] > {
	if ( ! site ) {
		return [];
	}
	if ( site.remote ) {
		const capabilities = site.wpcomSiteId
			? await getWpcomSiteCapabilities( site.wpcomSiteId )
			: undefined;
		return capabilities ? [ `${ describeWpcomSiteCapabilities( capabilities ) }.` ] : [];
	}
	const version = await getWordPressVersionFromInstallation( site.path );
	return version ? [ `WordPress ${ version }.` ] : [];
}
