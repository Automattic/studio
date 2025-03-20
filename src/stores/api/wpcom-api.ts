import { createApi } from '@reduxjs/toolkit/query/react';
import type { FetchBaseQueryError } from '@reduxjs/toolkit/query';
import type WPCOM from 'wpcom';

export interface WelcomeMessageResponse {
	messages: string[];
	example_prompts: string[];
}

let wpcomClient: WPCOM | undefined;

export const setWpcomClient = ( client: WPCOM | undefined ) => {
	wpcomClient = client;
};

const wpComBaseQuery = async ( args: { path: string; apiNamespace?: string } ) => {
	if ( ! wpcomClient?.req ) {
		return {
			error: {
				status: 401,
				data: 'Not authenticated',
			} as FetchBaseQueryError,
		};
	}

	try {
		const response = await wpcomClient.req.get( args );
		return { data: response };
	} catch ( error ) {
		return {
			error: {
				status: 500,
				data: error,
			} as FetchBaseQueryError,
		};
	}
};

export const wpComApi = createApi( {
	reducerPath: 'wpComApi',
	baseQuery: wpComBaseQuery,
	endpoints: ( builder ) => ( {
		getWelcomeMessages: builder.query< WelcomeMessageResponse, void >( {
			query: () => ( {
				path: '/studio-app/ai-assistant/welcome',
				apiNamespace: 'wpcom/v2',
			} ),
		} ),
	} ),
} );

export const { useGetWelcomeMessagesQuery } = wpComApi;
