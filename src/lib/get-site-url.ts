export function getSiteUrl( site: SiteDetails ) {
	return site.customDomain ? `http://${ site.customDomain }` : `http://localhost:${ site.port }`;
}
