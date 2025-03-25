import { createApi, TypedUseQuery } from '@reduxjs/toolkit/query/react';
import * as Sentry from '@sentry/electron/renderer';
import { z } from 'zod';
import { withOfflineCheck } from 'src/stores/tests/utils/with-offline-check';
import type { BaseQueryFn, FetchBaseQueryError } from '@reduxjs/toolkit/query';
import type WPCOM from 'wpcom';

const welcomeMessageSchema = z.object( {
	messages: z.array( z.string() ),
	example_prompts: z.array( z.string() ),
} );

export type WelcomeMessageResponse = z.infer< typeof welcomeMessageSchema >;

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

export const wpcomApi = createApi( {
	reducerPath: 'wpcomApi',
	baseQuery: wpcomBaseQuery,
	tagTypes: [ 'WelcomeMessages' ],
	endpoints: ( builder ) => ( {
		getWelcomeMessages: builder.query< WelcomeMessageResponse, void >( {
			query: () => ( {
				path: '/studio-app/ai-assistant/welcome',
				apiNamespace: 'wpcom/v2',
			} ),
			transformResponse: ( response: unknown ) => {
				try {
					return welcomeMessageSchema.parse( response );
				} catch ( error ) {
					Sentry.captureException( error );
					throw error;
				}
			},
			keepUnusedDataFor: 60 * 60,
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

const { useGetWelcomeMessagesQuery } = wpcomApi;

export const useGetWelcomeMessages = withWpcomClientCheck(
	withOfflineCheck( useGetWelcomeMessagesQuery )
);
