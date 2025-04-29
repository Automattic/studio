import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { getIpcApi } from 'src/lib/get-ipc-api';

type InstalledAppsState = InstalledApps & InstalledTerminals;

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
						data: {
							vscode: false,
							phpstorm: false,
							webstorm: false,
							windsurf: false,
							cursor: false,
							terminal: false,
							iterm: false,
							ghostty: false,
							warp: false,
						},
					};
				}
			},
			providesTags: [ 'InstalledApps' ],
		} ),
	} ),
} );

export const { useGetInstalledAppsQuery } = installedAppsApi;
