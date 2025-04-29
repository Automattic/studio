import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { getIpcApi } from 'src/lib/get-ipc-api';

export type InstalledAppsState = InstalledApps & InstalledTerminals;

export const installedAppsInitialState: InstalledAppsState = {
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
					return {
						data: installedAppsInitialState,
					};
				}
			},
			providesTags: [ 'InstalledApps' ],
		} ),
	} ),
} );

export const { useGetInstalledAppsQuery } = installedAppsApi;
