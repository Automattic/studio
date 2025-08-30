import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import * as Sentry from '@sentry/electron/renderer';
import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import { fetchWordPressVersions, type WordPressVersion } from 'common/lib/wp-org/versions';
import { withOfflineCheck } from 'src/stores/utils/with-offline-check';

export const wordpressVersionsApi = createApi( {
	reducerPath: 'wordpressVersionsApi',
	baseQuery: fetchBaseQuery(),
	endpoints: ( builder ) => ( {
		getWordPressVersions: builder.query< WordPressVersion[], void >( {
			queryFn: async () => {
				try {
					const versions = await fetchWordPressVersions();
					return {
						data: versions,
					};
				} catch ( error ) {
					if ( error instanceof z.ZodError ) {
						Sentry.captureException( error );
					}
					Sentry.captureException( error );
					throw error;
				}
			},
		} ),
	} ),
} );

const { useGetWordPressVersionsQuery } = wordpressVersionsApi;
export const useGetWordPressVersions = withOfflineCheck( useGetWordPressVersionsQuery );
