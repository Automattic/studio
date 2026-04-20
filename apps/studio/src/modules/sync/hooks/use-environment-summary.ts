import { useEffect, useState } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useGetPostCountsQuery } from 'src/stores/sync/environment-summary-api';

export type EnvironmentSummary = {
	counts: {
		posts: number;
		pages: number;
	};
	isLoading: boolean;
	isError: boolean;
};

export type EnvironmentSummarySource =
	| { kind: 'remote'; siteId: number }
	| { kind: 'local'; localSiteId: string };

function sumStatuses( counts: Record< string, number > | undefined ): number {
	if ( ! counts ) return 0;
	return Object.values( counts ).reduce( ( a, b ) => a + b, 0 );
}

function useLocalSummary( localSiteId: string | null ): EnvironmentSummary {
	const [ state, setState ] = useState< EnvironmentSummary >( {
		counts: { posts: 0, pages: 0 },
		isLoading: Boolean( localSiteId ),
		isError: false,
	} );
	useEffect( () => {
		if ( ! localSiteId ) return;
		let cancelled = false;
		setState( ( s ) => ( { ...s, isLoading: true, isError: false } ) );
		getIpcApi()
			.getLocalSiteSummary( { localSiteId } )
			.then( ( counts ) => {
				if ( ! cancelled ) {
					setState( { counts, isLoading: false, isError: false } );
				}
			} )
			.catch( () => {
				if ( ! cancelled ) {
					setState( ( s ) => ( { ...s, isLoading: false, isError: true } ) );
				}
			} );
		return () => {
			cancelled = true;
		};
	}, [ localSiteId ] );
	return state;
}

export function useEnvironmentSummary( source: EnvironmentSummarySource ): EnvironmentSummary {
	const postsQuery = useGetPostCountsQuery(
		source.kind === 'remote' ? { siteId: source.siteId, postType: 'post' } : ( {} as any ),
		{ skip: source.kind !== 'remote' }
	);
	const pagesQuery = useGetPostCountsQuery(
		source.kind === 'remote' ? { siteId: source.siteId, postType: 'page' } : ( {} as any ),
		{ skip: source.kind !== 'remote' }
	);
	const local = useLocalSummary( source.kind === 'local' ? source.localSiteId : null );

	if ( source.kind === 'local' ) {
		return local;
	}

	return {
		counts: {
			posts: sumStatuses( postsQuery.data?.counts.all ),
			pages: sumStatuses( pagesQuery.data?.counts.all ),
		},
		isLoading: postsQuery.isLoading || pagesQuery.isLoading,
		isError: Boolean( postsQuery.isError || pagesQuery.isError ),
	};
}
