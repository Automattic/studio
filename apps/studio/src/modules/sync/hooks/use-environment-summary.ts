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

export function useEnvironmentSummary( source: EnvironmentSummarySource ): EnvironmentSummary {
	const postsQuery = useGetPostCountsQuery(
		source.kind === 'remote' ? { siteId: source.siteId, postType: 'post' } : ( {} as any ),
		{ skip: source.kind !== 'remote' }
	);
	const pagesQuery = useGetPostCountsQuery(
		source.kind === 'remote' ? { siteId: source.siteId, postType: 'page' } : ( {} as any ),
		{ skip: source.kind !== 'remote' }
	);

	// Local-site summaries: Task 8 replaces this with a real in-process fetch.
	if ( source.kind === 'local' ) {
		return {
			counts: { posts: 0, pages: 0 },
			isLoading: false,
			isError: false,
		};
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
