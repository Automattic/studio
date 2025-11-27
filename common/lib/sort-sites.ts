export function sortSites< T extends { name: string } >( sites: T[] ): T[] {
	return sites.sort( ( a, b ) => a.name.localeCompare( b.name, undefined, { numeric: true } ) );
}
