export function sortSites< T extends { name: string; sortOrder?: number } >( sites: T[] ): T[] {
	const MAX = Number.MAX_SAFE_INTEGER;
	return sites.sort( ( a, b ) => {
		return (
			( a.sortOrder ?? MAX ) - ( b.sortOrder ?? MAX ) ||
			a.name.localeCompare( b.name, undefined, { numeric: true } )
		);
	} );
}
