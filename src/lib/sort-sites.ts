export function sortSites( sites: SiteDetails[] ): SiteDetails[] {
	return sites.sort( ( a, b ) => a.name.localeCompare( b.name ) );
}
