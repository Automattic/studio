import { createApi, TypedUseQuery } from '@reduxjs/toolkit/query/react';
import * as Sentry from '@sentry/electron/renderer';
import { z } from 'zod';
import { useOffline } from 'src/hooks/use-offline';
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

function withConnectionChecks< TResult, TArg >(
	useQueryHook: TypedUseQuery< TResult, TArg, typeof wpcomBaseQuery >
): TypedUseQuery< TResult, TArg, typeof wpcomBaseQuery > {
	return ( arg, options = {} ) => {
		const isOffline = useOffline();
		return useQueryHook( arg, {
			...options,
			skip: ! wpcomClient || isOffline || options?.skip,
		} );
	};
}

const { useGetWelcomeMessagesQuery } = wpcomApi;

export const useGetWelcomeMessages = withConnectionChecks( useGetWelcomeMessagesQuery );
