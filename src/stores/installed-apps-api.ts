import { createSelector } from '@reduxjs/toolkit';
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import {
	SupportedEditorConfig,
	SupportedEditor,
	supportedEditorConfig,
	SUPPORTED_EDITORS,
} from 'src/modules/user-settings/lib/editor';
import {
	SupportedTerminal,
	terminalConfig,
	getTerminalsSupportedOnPlatform,
} from 'src/modules/user-settings/lib/terminal';

const getFirstInstalledEditor = async (): Promise< SupportedEditor | null > => {
	const installedApps = await getIpcApi().getInstalledAppsAndTerminals();
	for ( const editor of SUPPORTED_EDITORS ) {
		if ( installedApps[ editor ] ) {
			return editor;
		}
	}

	return null;
};

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
				// and set the default to the first one found in priority order
				const defaultEditor = await getFirstInstalledEditor();

				return { data: defaultEditor };
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
		saveUserEditor: builder.mutation< SupportedEditor, SupportedEditor >( {
			queryFn: async ( editor ) => {
				await getIpcApi().saveUserEditor( editor );
				return { data: editor };
			},
			invalidatesTags: [ 'UserPreferences' ],
		} ),
		saveUserTerminal: builder.mutation< SupportedTerminal, SupportedTerminal >( {
			queryFn: async ( terminal ) => {
				await getIpcApi().saveUserTerminal( terminal );
				return { data: terminal };
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
		const supportedTerminals = getTerminalsSupportedOnPlatform();
		return supportedTerminals
			.filter( ( terminal ) => installedApps && installedApps[ terminal ] )
			.map(
				( terminal ) =>
					[ terminal, terminalConfig[ terminal ].name ] as [ SupportedTerminal, string ]
			);
	}
);

export const selectUninstalledTerminals = createSelector(
	[ ( data?: InstalledApps ) => data ],
	( installedApps ) => {
		const supportedTerminals = getTerminalsSupportedOnPlatform();
		return supportedTerminals
			.filter( ( terminal ) => ! installedApps || ! installedApps[ terminal ] )
			.map(
				( terminal ) =>
					[ terminal, terminalConfig[ terminal ].name ] as [ SupportedTerminal, string ]
			);
	}
);
