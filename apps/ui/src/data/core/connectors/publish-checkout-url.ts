import { stripLocalDomainSuffix } from '@studio/common/lib/domains';
import type { SiteDetails } from '../types';

export function buildPreviewLaunchUrl( hostname: string ): string {
	const url = new URL( 'https://wordpress.com/setup/launch-site' );
	url.searchParams.set( 'siteSlug', hostname );
	url.searchParams.set( 'hide_free_plan', '1' );
	url.searchParams.set( 'checkout_source', 'studio-preview-site' );
	return url.toString();
}

export function buildPublishCheckoutUrl( site: SiteDetails ): string {
	const url = new URL( 'https://wordpress.com/setup/new-hosted-site' );
	url.searchParams.set( 'ref', 'studio' );
	url.searchParams.set( 'section', 'publish-site' );
	url.searchParams.set( 'showDomainStep', 'true' );
	url.searchParams.set( 'studioSiteId', site.id );
	url.searchParams.set(
		'new',
		site.customDomain ? stripLocalDomainSuffix( site.customDomain ) : site.name
	);
	url.searchParams.set( 'autoOpenPush', 'true' );
	return url.toString();
}
