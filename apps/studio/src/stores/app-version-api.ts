import { createSelector } from '@reduxjs/toolkit';
import { BaseQueryFn } from '@reduxjs/toolkit/query';
import { createApi, fetchBaseQuery, TypedUseQueryStateResult } from '@reduxjs/toolkit/query/react';
import { FORCE_SHOW_WHATS_NEW } from 'src/constants';
import { getIpcApi } from 'src/lib/get-ipc-api';

export const appVersionApi = createApi( {
	reducerPath: 'appVersionApi',
	baseQuery: fetchBaseQuery(),
	tagTypes: [ 'LastSeenVersion' ],
	endpoints: ( builder ) => ( {
		getLastSeenVersion: builder.query< string | undefined, void >( {
			queryFn: async () => {
				try {
					const version = await getIpcApi().getLastSeenVersion();
					return { data: version };
				} catch ( error ) {
					console.error( 'Failed to get last seen version:', error );
					throw error;
				}
			},
			providesTags: [ 'LastSeenVersion' ],
		} ),
		saveLastSeenVersion: builder.mutation< string, string >( {
			queryFn: async ( version ) => {
				try {
					await getIpcApi().saveLastSeenVersion( version );
					return { data: version };
				} catch ( error ) {
					console.error( 'Failed to save last seen version:', error );
					throw error;
				}
			},
			invalidatesTags: [ 'LastSeenVersion' ],
		} ),
	} ),
} );

export const { useGetLastSeenVersionQuery, useSaveLastSeenVersionMutation } = appVersionApi;

type GetLastSeenVersionQueryResult = TypedUseQueryStateResult<
	string | undefined,
	void,
	BaseQueryFn
>;

// The modal auto-shows only for first-time users (no stored `lastSeenVersion`)
// or when `FORCE_SHOW_WHATS_NEW` is flipped to `true` and the user hasn't
// dismissed it on the current app version yet. Patch/minor/major bumps alone
// never trigger the modal — devs must opt in via the constant.
export const selectIsNewVersion = createSelector(
	[
		( res: GetLastSeenVersionQueryResult ) => res.data,
		( _res: GetLastSeenVersionQueryResult, currentVersion: string ) => currentVersion,
	],
	( lastSeenVersion, currentVersion ) => {
		if ( ! lastSeenVersion ) {
			return true;
		}
		return FORCE_SHOW_WHATS_NEW && lastSeenVersion !== currentVersion;
	}
);
