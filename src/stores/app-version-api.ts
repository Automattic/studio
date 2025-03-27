import { createSelector } from '@reduxjs/toolkit';
import { BaseQueryFn } from '@reduxjs/toolkit/query';
import { createApi, fetchBaseQuery, TypedUseQueryStateResult } from '@reduxjs/toolkit/query/react';
import semver from 'semver';
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

export const selectIsNewVersion = createSelector(
	( res: GetLastSeenVersionQueryResult ) => res.data,
	( res: GetLastSeenVersionQueryResult, currentVersion: string ) => currentVersion,
	( lastSeenVersion, currentVersion ) => {
		if ( ! currentVersion || ! lastSeenVersion ) {
			return !! currentVersion && lastSeenVersion !== currentVersion;
		}

		try {
			if ( semver.prerelease( currentVersion ) ) {
				return false;
			}

			const cleanLastSeen = semver.valid( semver.coerce( lastSeenVersion ) );
			const cleanCurrent = semver.valid( semver.coerce( currentVersion ) );

			if ( ! cleanLastSeen || ! cleanCurrent ) {
				return false;
			}

			const lastSeenParts = semver.parse( cleanLastSeen );
			const currentParts = semver.parse( cleanCurrent );

			if ( ! lastSeenParts || ! currentParts ) {
				return false;
			}

			return (
				lastSeenParts.major !== currentParts.major || lastSeenParts.minor !== currentParts.minor
			);
		} catch ( error ) {
			console.error( 'Error comparing versions:', error );
			return lastSeenVersion !== currentVersion;
		}
	}
);
