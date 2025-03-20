export function getSiteUrl( site: SiteDetails ) {
	if ( site.customDomain ) {
		const protocol = site.enableSSL ? 'https' : 'http';
		return `${ protocol }://${ site.customDomain }`;
	}

	return `http://localhost:${ site.port }`;
}
