import { DEFAULT_CUSTOM_DOMAIN_SUFFIX } from '@studio/common/constants';
import { SiteData } from './cli-config/core';

export function generateCheckoutUrl(
	selectedSite?: SiteData,
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
		? selectedSite.customDomain.replace( DEFAULT_CUSTOM_DOMAIN_SUFFIX, '' )
		: selectedSite.name;

	url.searchParams.set( 'studioSiteId', String( selectedSite.id ) );
	url.searchParams.set( 'new', suggestedName );

	if ( options?.autoOpenPush ) {
		url.searchParams.set( 'autoOpenPush', 'true' );
	}

	return url.toString();
}
