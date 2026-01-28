export function sortSites< T extends { name: string; sortOrder?: number } >( sites: T[] ): T[] {
	return sites.sort( ( a, b ) => {
		// If both have sortOrder, sort by sortOrder
		if ( a.sortOrder !== undefined && b.sortOrder !== undefined ) {
			return a.sortOrder - b.sortOrder;
		}
		// If only a has sortOrder, a comes first
		if ( a.sortOrder !== undefined ) {
			return -1;
		}
		// If only b has sortOrder, b comes first
		if ( b.sortOrder !== undefined ) {
			return 1;
		}
		// Neither has sortOrder, sort by name
		return a.name.localeCompare( b.name, undefined, { numeric: true } );
	} );
}
