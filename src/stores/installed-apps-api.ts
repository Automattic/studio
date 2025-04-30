import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { getIpcApi } from 'src/lib/get-ipc-api';

export type InstalledAppsState = InstalledApps & InstalledTerminals;

export const installedAppsApi = createApi( {
	reducerPath: 'installedAppsApi',
	baseQuery: fetchBaseQuery(),
	tagTypes: [ 'InstalledApps' ],
	endpoints: ( builder ) => ( {
		getInstalledApps: builder.query< InstalledAppsState, void >( {
			queryFn: async () => {
				const installedApps = await getIpcApi().getInstalledApps();
				return { data: installedApps };
			},
			providesTags: [ 'InstalledApps' ],
		} ),
	} ),
} );

export const { useGetInstalledAppsQuery } = installedAppsApi;
