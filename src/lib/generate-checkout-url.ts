import { DEFAULT_CUSTOM_DOMAIN_SUFFIX } from 'common/constants';

export function generateCheckoutUrl( selectedSite?: SiteDetails ): string {
	const url = new URL(
		'https://wordpress.com/setup/new-hosted-site?ref=studio&section=studio-sync&showDomainStep'
	);

	if ( ! selectedSite ) {
		return url.toString();
	}

	const suggestedName = selectedSite.customDomain
		? selectedSite.customDomain.replace( DEFAULT_CUSTOM_DOMAIN_SUFFIX, '' )
		: selectedSite.name;

	url.searchParams.set( 'studioSiteId', String( selectedSite.id ) );
	url.searchParams.set( 'new', suggestedName );

	return url.toString();
}
