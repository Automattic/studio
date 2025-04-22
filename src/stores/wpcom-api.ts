import { createApi, TypedUseQuery } from '@reduxjs/toolkit/query/react';
import * as Sentry from '@sentry/electron/renderer';
import { z } from 'zod';
import { withOfflineCheck } from 'src/stores/utils/with-offline-check';
import type { BaseQueryFn, FetchBaseQueryError } from '@reduxjs/toolkit/query';
import type WPCOM from 'wpcom';

const welcomeMessageSchema = z.object( {
	messages: z.array( z.string() ),
	example_prompts: z.array( z.string() ),
} );

const snapshotUsageSchema = z
	.object( {
		site_count: z.number(),
		site_limit: z.number(),
		site_creation_blocked: z.boolean(),
	} )
	.transform( ( data ) => ( {
		siteCount: data.site_count,
		siteLimit: data.site_limit,
		siteCreationBlocked: data.site_creation_blocked,
	} ) );

export type WelcomeMessageResponse = z.infer< typeof welcomeMessageSchema >;
export type SnapshotUsageResponse = z.infer< typeof snapshotUsageSchema >;

let wpcomClient: WPCOM | undefined;

export const setWpcomClient = ( client: WPCOM | undefined ) => {
	wpcomClient = client;
};

const wpcomBaseQuery: BaseQueryFn<
	{ path: string; apiNamespace?: string },
	unknown,
	FetchBaseQueryError
> = async ( args ) => {
	try {
		const response = await wpcomClient!.req.get( args );
		return { data: response };
	} catch ( error ) {
		return {
			error: {
				status: 500,
				data: error,
			},
		};
	}
};

function parseResponse< TSchema extends z.ZodTypeAny >( response: unknown, schema: TSchema ) {
	try {
		return schema.parse( response );
	} catch ( error ) {
		Sentry.captureException( error );
		throw error;
	}
}
export const wpcomApi = createApi( {
	reducerPath: 'wpcomApi',
	baseQuery: wpcomBaseQuery,
	tagTypes: [ 'SnapshotUsage' ],
	endpoints: ( builder ) => ( {
		getWelcomeMessages: builder.query< WelcomeMessageResponse, void >( {
			query: () => ( {
				path: '/studio-app/ai-assistant/welcome',
				apiNamespace: 'wpcom/v2',
			} ),
			transformResponse: ( response: unknown ) => parseResponse( response, welcomeMessageSchema ),
			keepUnusedDataFor: 60 * 60,
		} ),
		getSnapshotUsage: builder.query< SnapshotUsageResponse, void >( {
			query: () => ( {
				path: '/jurassic-ninja/usage',
				apiNamespace: 'wpcom/v2',
			} ),
			transformResponse: ( response: unknown ) => parseResponse( response, snapshotUsageSchema ),
			keepUnusedDataFor: 60 * 60,
			providesTags: [ { type: 'SnapshotUsage' } ],
		} ),
	} ),
} );

function withWpcomClientCheck< TResult, TArg >(
	useQueryHook: TypedUseQuery< TResult, TArg, typeof wpcomBaseQuery >
): TypedUseQuery< TResult, TArg, typeof wpcomBaseQuery > {
	return ( arg, options = {} ) => {
		return useQueryHook( arg, {
			...options,
			skip: ! wpcomClient || options?.skip,
		} );
	};
}

const { useGetWelcomeMessagesQuery, useGetSnapshotUsageQuery } = wpcomApi;

export const useGetWelcomeMessages = withWpcomClientCheck(
	withOfflineCheck( useGetWelcomeMessagesQuery )
);

export const useGetSnapshotUsage = withWpcomClientCheck(
	withOfflineCheck( useGetSnapshotUsageQuery )
);
