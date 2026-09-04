import { stripLocalDomainSuffix } from '@studio/common/lib/domains';

export function generateCheckoutUrl(
	selectedSite?: SiteDetails,
	section: string = 'studio-sync',
	options?: { autoOpenPush?: boolean }
): string {
	const url = new URL( 'https://wordpress.com/setup/new-hosted-site' );
	url.searchParams.set( 'ref', 'studio' );
	url.searchParams.set( 'section', section );
	url.searchParams.set( 'showDomainStep', 'true' );

	if ( ! selectedSite ) {
		return url.toString();
	}

	const suggestedName = selectedSite.customDomain
		? stripLocalDomainSuffix( selectedSite.customDomain )
		: selectedSite.name;

	url.searchParams.set( 'studioSiteId', String( selectedSite.id ) );
	url.searchParams.set( 'new', suggestedName );

	if ( options?.autoOpenPush ) {
		url.searchParams.set( 'autoOpenPush', 'true' );
	}

	return url.toString();
}
