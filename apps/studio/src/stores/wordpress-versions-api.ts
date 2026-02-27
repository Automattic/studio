import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import * as Sentry from '@sentry/electron/renderer';
import {
	fetchWordPressVersions,
	type WordPressVersion,
} from '@studio/common/lib/wordpress-versions';
import { z } from 'zod';
import { withOfflineCheck } from 'src/stores/utils/with-offline-check';

export const wordpressVersionsApi = createApi( {
	reducerPath: 'wordpressVersionsApi',
	baseQuery: fetchBaseQuery(),
	endpoints: ( builder ) => ( {
		getWordPressVersions: builder.query< WordPressVersion[], { minimumVersion: string } >( {
			queryFn: async () => {
				try {
					const versions = await fetchWordPressVersions();
					return { data: versions };
				} catch ( error ) {
					if ( error instanceof z.ZodError ) {
						Sentry.captureException( error );
					}
					throw error;
				}
			},
		} ),
	} ),
} );

const { useGetWordPressVersionsQuery } = wordpressVersionsApi;
export const useGetWordPressVersions = withOfflineCheck( useGetWordPressVersionsQuery );
