/**
 * Loader: parses the URL search-string into a typed intent and exposes it via
 * the loader API so `stage.tsx` doesn't have to repeat the parsing.
 */

const DEFAULT_COLUMNS = [ 'title', 'date', 'status' ];
const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;

export type ListLoaderData = {
	postType: string;
	columns: string[];
	perPage: number;
	search: string;
};

interface LoaderArgs {
	search?: Record< string, string | undefined >;
}

function clampPerPage( raw: string | undefined ): number {
	if ( ! raw ) return DEFAULT_PER_PAGE;
	const n = Number( raw );
	if ( ! Number.isFinite( n ) || n < 1 ) return DEFAULT_PER_PAGE;
	return Math.min( Math.floor( n ), MAX_PER_PAGE );
}

function parseColumns( raw: string | undefined ): string[] {
	if ( ! raw ) return DEFAULT_COLUMNS;
	const list = raw
		.split( ',' )
		.map( ( c ) => c.trim() )
		.filter( ( c ) => c.length > 0 );
	return list.length > 0 ? list : DEFAULT_COLUMNS;
}

export const route = {
	loader: ( { search }: LoaderArgs ): ListLoaderData => ( {
		postType: ( search?.postType || 'post' ).trim(),
		columns: parseColumns( search?.columns ),
		perPage: clampPerPage( search?.perPage ),
		search: search?.search ?? '',
	} ),
};
