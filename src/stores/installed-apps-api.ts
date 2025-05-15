import { createSelector } from '@reduxjs/toolkit';
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import {
	SupportedEditorConfig,
	SupportedEditor,
	supportedEditorConfig,
} from 'src/modules/user-settings/lib/editor';
import { SupportedTerminal, supportedTerminalNames } from 'src/modules/user-settings/lib/terminal';

export const installedAppsApi = createApi( {
	reducerPath: 'installedAppsApi',
	baseQuery: fetchBaseQuery(),
	tagTypes: [ 'InstalledApps', 'UserPreferences' ],
	endpoints: ( builder ) => ( {
		getInstalledApps: builder.query< InstalledApps, void >( {
			queryFn: async () => {
				const installedApps = await getIpcApi().getInstalledAppsAndTerminals();
				return { data: installedApps };
			},
			providesTags: [ 'InstalledApps' ],
		} ),
		getUserEditor: builder.query< SupportedEditor | null, void >( {
			queryFn: async () => {
				const editor = await getIpcApi().getUserEditor();
				// Respect user preference if it is set
				if ( editor ) {
					return { data: editor };
				}

				// If no user preference is set, check for installed editors
				// and set the default to the first one found
				// This is a fallback to ensure we keep existing behavior
				const installedEditors = await getIpcApi().getInstalledAppsAndTerminals();
				if ( installedEditors.vscode ) {
					return { data: 'vscode' };
				} else if ( installedEditors.phpstorm ) {
					return { data: 'phpstorm' };
				}

				// If no user preference is set, return null
				return { data: null };
			},
			providesTags: [ 'UserPreferences' ],
		} ),
		getUserTerminal: builder.query< SupportedTerminal, void >( {
			queryFn: async () => {
				const terminal = await getIpcApi().getUserTerminal();
				return { data: terminal };
			},
			providesTags: [ 'UserPreferences' ],
		} ),
		saveUserEditor: builder.mutation< void, SupportedEditor >( {
			queryFn: async ( editor ) => {
				await getIpcApi().saveUserEditor( editor );
				return { data: undefined };
			},
			invalidatesTags: [ 'UserPreferences' ],
		} ),
		saveUserTerminal: builder.mutation< void, SupportedTerminal >( {
			queryFn: async ( terminal ) => {
				await getIpcApi().saveUserTerminal( terminal );
				return { data: undefined };
			},
			invalidatesTags: [ 'UserPreferences' ],
		} ),
	} ),
} );

export const {
	useGetInstalledAppsQuery,
	useGetUserEditorQuery,
	useGetUserTerminalQuery,
	useSaveUserEditorMutation,
	useSaveUserTerminalMutation,
} = installedAppsApi;

export const selectInstalledEditors = createSelector(
	[ ( data?: InstalledApps ) => data ],
	( installedApps ) => {
		const entries = Object.entries( supportedEditorConfig ) as [
			SupportedEditor,
			SupportedEditorConfig,
		][];

		return entries.filter( ( [ editor ] ) => installedApps && installedApps[ editor ] );
	}
);

export const selectUninstalledEditors = createSelector(
	[ ( data?: InstalledApps ) => data ],
	( installedApps ) => {
		const entries = Object.entries( supportedEditorConfig ) as [
			SupportedEditor,
			SupportedEditorConfig,
		][];

		return entries.filter( ( [ editor ] ) => ! installedApps || ! installedApps[ editor ] );
	}
);

export const selectInstalledTerminals = createSelector(
	[ ( data?: InstalledApps ) => data ],
	( installedApps ) => {
		const entries = Object.entries( supportedTerminalNames ) as [ SupportedTerminal, string ][];

		return entries.filter( ( [ terminal ] ) => installedApps && installedApps[ terminal ] );
	}
);

export const selectUninstalledTerminals = createSelector(
	[ ( data?: InstalledApps ) => data ],
	( installedApps ) => {
		const entries = Object.entries( supportedTerminalNames ) as [ SupportedTerminal, string ][];

		return entries.filter( ( [ terminal ] ) => ! installedApps || ! installedApps[ terminal ] );
	}
);
