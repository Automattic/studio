import { createSelector } from '@reduxjs/toolkit';
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import {
	SupportedEditorConfig,
	SupportedEditor,
	supportedEditorConfig,
} from 'src/modules/user-settings/lib/editor';
import { SupportedTerminal, supportedTerminalNames } from 'src/modules/user-settings/lib/terminal';

export type InstalledAppsState = InstalledApps & InstalledTerminals;

export const installedAppsApi = createApi( {
	reducerPath: 'installedAppsApi',
	baseQuery: fetchBaseQuery(),
	tagTypes: [ 'InstalledApps' ],
	endpoints: ( builder ) => ( {
		getInstalledApps: builder.query< InstalledAppsState, void >( {
			queryFn: async () => {
				const installedApps = await getIpcApi().getInstalledAppsAndTerminals();
				return { data: installedApps };
			},
			providesTags: [ 'InstalledApps' ],
		} ),
	} ),
} );

export const { useGetInstalledAppsQuery } = installedAppsApi;

export const selectInstalledEditors = createSelector(
	[ ( data?: InstalledAppsState ) => data ],
	( installedApps ) => {
		const entries = Object.entries( supportedEditorConfig ) as [
			SupportedEditor,
			SupportedEditorConfig,
		][];

		return entries.filter( ( [ editor ] ) => installedApps && installedApps[ editor ] );
	}
);

export const selectUninstalledEditors = createSelector(
	[ ( data?: InstalledAppsState ) => data ],
	( installedApps ) => {
		const entries = Object.entries( supportedEditorConfig ) as [
			SupportedEditor,
			SupportedEditorConfig,
		][];

		return entries.filter( ( [ editor ] ) => ! installedApps || ! installedApps[ editor ] );
	}
);

export const selectInstalledTerminals = createSelector(
	[ ( data?: InstalledAppsState ) => data ],
	( installedApps ) => {
		const entries = Object.entries( supportedTerminalNames ) as [ SupportedTerminal, string ][];

		console.log( 'selectInstalledTerminals', entries, installedApps );
		return entries.filter( ( [ terminal ] ) => installedApps && installedApps[ terminal ] );
	}
);

export const selectUninstalledTerminals = createSelector(
	[ ( data?: InstalledAppsState ) => data ],
	( installedApps ) => {
		const entries = Object.entries( supportedTerminalNames ) as [ SupportedTerminal, string ][];

		return entries.filter( ( [ terminal ] ) => ! installedApps || ! installedApps[ terminal ] );
	}
);
