import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type { LinkedExtension } from 'src/modules/cli/lib/execute-link-command';

export type { LinkedExtension };

interface LinkArgs {
	siteId: string;
	sourcePath: string;
}

interface UnlinkArgs {
	siteId: string;
	name: string;
}

function toQueryError( err: unknown ) {
	let message: string;
	if ( err instanceof Error ) {
		message = err.message;
	} else if ( typeof err === 'object' && err !== null && 'message' in err ) {
		const value = ( err as { message: unknown } ).message;
		message = typeof value === 'string' ? value : JSON.stringify( err );
	} else {
		message = typeof err === 'string' ? err : JSON.stringify( err );
	}
	return { error: { status: 'CUSTOM_ERROR' as const, error: message } };
}

export const linkedExtensionsApi = createApi( {
	reducerPath: 'linkedExtensionsApi',
	baseQuery: fetchBaseQuery(),
	tagTypes: [ 'LinkedPlugins', 'LinkedThemes' ],
	endpoints: ( builder ) => ( {
		getLinkedPlugins: builder.query< LinkedExtension[], string >( {
			queryFn: async ( siteId ) => {
				try {
					const data = await getIpcApi().listLinkedPlugins( siteId );
					return { data };
				} catch ( err ) {
					return toQueryError( err );
				}
			},
			providesTags: ( _result, _error, siteId ) => [ { type: 'LinkedPlugins', id: siteId } ],
		} ),
		getLinkedThemes: builder.query< LinkedExtension[], string >( {
			queryFn: async ( siteId ) => {
				try {
					const data = await getIpcApi().listLinkedThemes( siteId );
					return { data };
				} catch ( err ) {
					return toQueryError( err );
				}
			},
			providesTags: ( _result, _error, siteId ) => [ { type: 'LinkedThemes', id: siteId } ],
		} ),
		linkPlugin: builder.mutation< void, LinkArgs >( {
			queryFn: async ( { siteId, sourcePath } ) => {
				try {
					await getIpcApi().linkPlugin( siteId, sourcePath );
					return { data: undefined };
				} catch ( err ) {
					return toQueryError( err );
				}
			},
			invalidatesTags: ( _result, _error, { siteId } ) => [ { type: 'LinkedPlugins', id: siteId } ],
		} ),
		linkTheme: builder.mutation< void, LinkArgs >( {
			queryFn: async ( { siteId, sourcePath } ) => {
				try {
					await getIpcApi().linkTheme( siteId, sourcePath );
					return { data: undefined };
				} catch ( err ) {
					return toQueryError( err );
				}
			},
			invalidatesTags: ( _result, _error, { siteId } ) => [ { type: 'LinkedThemes', id: siteId } ],
		} ),
		unlinkPlugin: builder.mutation< void, UnlinkArgs >( {
			queryFn: async ( { siteId, name } ) => {
				try {
					await getIpcApi().unlinkPlugin( siteId, name );
					return { data: undefined };
				} catch ( err ) {
					return toQueryError( err );
				}
			},
			invalidatesTags: ( _result, _error, { siteId } ) => [ { type: 'LinkedPlugins', id: siteId } ],
		} ),
		unlinkTheme: builder.mutation< void, UnlinkArgs >( {
			queryFn: async ( { siteId, name } ) => {
				try {
					await getIpcApi().unlinkTheme( siteId, name );
					return { data: undefined };
				} catch ( err ) {
					return toQueryError( err );
				}
			},
			invalidatesTags: ( _result, _error, { siteId } ) => [ { type: 'LinkedThemes', id: siteId } ],
		} ),
	} ),
} );

export const {
	useGetLinkedPluginsQuery,
	useGetLinkedThemesQuery,
	useLinkPluginMutation,
	useLinkThemeMutation,
	useUnlinkPluginMutation,
	useUnlinkThemeMutation,
} = linkedExtensionsApi;
