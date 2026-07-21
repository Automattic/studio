import type { SiteDetails } from '../types';

export function buildPublishCheckoutUrl( site: SiteDetails ): string {
	const url = new URL( 'https://wordpress.com/setup/new-hosted-site' );
	url.searchParams.set( 'ref', 'studio1' );
	url.searchParams.set( 'section', 'publish-site' );
	url.searchParams.set( 'showDomainStep', 'true' );
	url.searchParams.set( 'studioSiteId', site.id );
	url.searchParams.set( 'new', site.customDomain ?? site.name );
	url.searchParams.set( 'autoOpenPush', 'true' );
	return url.toString();
}
