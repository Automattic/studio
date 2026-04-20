import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { wpcomRequest } from 'src/lib/wpcom-request';

export type PostCountsResponse = {
	counts: {
		all: Record< string, number >;
		mine?: Record< string, number >;
	};
};

export const environmentSummaryApi = createApi( {
	reducerPath: 'environmentSummaryApi',
	baseQuery: fetchBaseQuery(),
	tagTypes: [ 'PostCounts' ],
	keepUnusedDataFor: 60,
	endpoints: ( builder ) => ( {
		getPostCounts: builder.query< PostCountsResponse, { siteId: number; postType: string } >( {
			queryFn: async ( { siteId, postType } ) => {
				try {
					const data = await wpcomRequest< PostCountsResponse >( {
						path: `/sites/${ siteId }/post-counts/${ postType }`,
						apiNamespace: 'wpcom/v2',
						apiVersion: '1.2',
					} );
					return { data };
				} catch ( error ) {
					return {
						error: { status: 'CUSTOM_ERROR', error: String( error ) } as any,
					};
				}
			},
			providesTags: ( _r, _e, { siteId, postType } ) => [
				{ type: 'PostCounts', id: `${ siteId }-${ postType }` },
			],
		} ),
	} ),
} );

export const { useGetPostCountsQuery } = environmentSummaryApi;
