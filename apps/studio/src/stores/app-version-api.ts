import { createSelector } from '@reduxjs/toolkit';
import { BaseQueryFn } from '@reduxjs/toolkit/query';
import { createApi, fetchBaseQuery, TypedUseQueryStateResult } from '@reduxjs/toolkit/query/react';
import semver from 'semver';
import { FORCE_WHATS_NEW_WHEN_PATCH_CHANGED } from 'src/constants';
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

function isGreaterExceptPatch( versionA: string | undefined, versionB: string ): boolean {
	if ( ! versionA ) {
		return true;
	}

	if (
		! semver.valid( versionA ) ||
		! semver.valid( versionB ) ||
		semver.gte( versionA, versionB )
	) {
		return false;
	}

	const a = semver.parse( versionA )!;
	const b = semver.parse( versionB )!;

	if (
		a.major === b.major &&
		a.minor === b.minor &&
		( a.patch !== b.patch || a.prerelease?.length !== b.prerelease?.length )
	) {
		return FORCE_WHATS_NEW_WHEN_PATCH_CHANGED;
	}
	return true;
}

export const selectIsNewVersion = createSelector(
	[
		( res: GetLastSeenVersionQueryResult ) => res.data,
		( res: GetLastSeenVersionQueryResult, currentVersion: string ) => currentVersion,
	],
	( lastSeenVersion, currentVersion ) => isGreaterExceptPatch( lastSeenVersion, currentVersion )
);
