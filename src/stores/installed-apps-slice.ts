import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { getIpcApi } from 'src/lib/get-ipc-api';

type InstalledAppsState = InstalledApps & InstalledTerminals;

// Default state where all apps are set to false
const defaultInstalledAppsState: InstalledAppsState = {
	vscode: false,
	phpstorm: false,
	webstorm: false,
	windsurf: false,
	cursor: false,
	terminal: false,
	iterm: false,
	ghostty: false,
	warp: false,
};

export const installedAppsApi = createApi( {
	reducerPath: 'installedAppsApi',
	baseQuery: fetchBaseQuery(),
	tagTypes: [ 'InstalledApps' ],
	endpoints: ( builder ) => ( {
		getInstalledApps: builder.query< InstalledAppsState, void >( {
			queryFn: async () => {
				try {
					const installedApps = await getIpcApi().getInstalledApps();
					return { data: installedApps as InstalledAppsState };
				} catch ( error ) {
					console.error( 'Failed to get installed apps:', error );
					throw error;
				}
			},
			providesTags: [ 'InstalledApps' ],
		} ),
	} ),
} );

export const { useGetInstalledAppsQuery } = installedAppsApi;
