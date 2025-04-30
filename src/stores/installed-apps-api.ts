import { createSelector } from '@reduxjs/toolkit';
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import {
	SupportedEditorConfig,
	SupportedEditor,
	supportedEditorConfig,
} from 'src/modules/user-settings/lib/editor';
import {
	SupportedTerminal,
	supportedTerminalNames,
	DEFAULT_TERMINAL,
} from 'src/modules/user-settings/lib/terminal';

export type InstalledAppsState = InstalledApps & InstalledTerminals;

export const installedAppsApi = createApi( {
	reducerPath: 'installedAppsApi',
	baseQuery: fetchBaseQuery(),
	tagTypes: [ 'InstalledApps', 'UserPreferences' ],
	endpoints: ( builder ) => ( {
		getInstalledApps: builder.query< InstalledAppsState, void >( {
			queryFn: async () => {
				const installedApps = await getIpcApi().getInstalledAppsAndTerminals();
				return { data: installedApps };
			},
			providesTags: [ 'InstalledApps' ],
		} ),
		getUserEditor: builder.query< SupportedEditor, void >( {
			queryFn: async () => {
				const editor = await getIpcApi().getUserEditor();
				return { data: editor };
			},
			providesTags: [ 'UserPreferences' ],
		} ),
		getUserTerminal: builder.query< SupportedTerminal, void >( {
			queryFn: async () => {
				const terminal = await getIpcApi().getUserTerminal();
				return { data: terminal || DEFAULT_TERMINAL };
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
