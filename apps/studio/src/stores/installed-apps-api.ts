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
	terminalConfig,
	getTerminalsSupportedOnPlatform,
} from 'src/modules/user-settings/lib/terminal';
import type { QuitSitesBehavior } from 'src/storage/user-data';

export const installedAppsApi = createApi( {
	reducerPath: 'installedAppsApi',
	baseQuery: fetchBaseQuery(),
	tagTypes: [
		'StudioCliIsInstalled',
		'InstalledApps',
		'UserEditor',
		'UserTerminal',
		'ColorScheme',
		'QuitSitesBehavior',
		'DefaultSiteDirectory',
		'AnalyticsEnabled',
	],
	endpoints: ( builder ) => ( {
		getStudioCliIsInstalled: builder.query< boolean, void >( {
			queryFn: async () => {
				const isInstalled = await getIpcApi().isStudioCliInstalled();
				return { data: isInstalled };
			},
			providesTags: [ 'StudioCliIsInstalled' ],
		} ),
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
				return { data: editor };
			},
			providesTags: [ 'UserEditor' ],
		} ),
		getUserTerminal: builder.query< SupportedTerminal, void >( {
			queryFn: async () => {
				const terminal = await getIpcApi().getUserTerminal();
				return { data: terminal };
			},
			providesTags: [ 'UserTerminal' ],
		} ),
		saveStudioCliIsInstalled: builder.mutation< boolean, boolean >( {
			queryFn: async ( isInstalled ) => {
				if ( isInstalled ) {
					await getIpcApi().installStudioCli();
				} else {
					await getIpcApi().uninstallStudioCli();
				}
				return { data: isInstalled };
			},
			invalidatesTags: [ 'StudioCliIsInstalled' ],
		} ),
		saveUserEditor: builder.mutation< SupportedEditor, SupportedEditor >( {
			queryFn: async ( editor ) => {
				await getIpcApi().saveUserEditor( editor );
				return { data: editor };
			},
			invalidatesTags: [ 'UserEditor' ],
		} ),
		saveUserTerminal: builder.mutation< SupportedTerminal, SupportedTerminal >( {
			queryFn: async ( terminal ) => {
				await getIpcApi().saveUserTerminal( terminal );
				return { data: terminal };
			},
			invalidatesTags: [ 'UserTerminal' ],
		} ),
		getColorScheme: builder.query< 'system' | 'light' | 'dark', void >( {
			queryFn: async () => {
				const colorScheme = await getIpcApi().getColorScheme();
				return { data: colorScheme };
			},
			providesTags: [ 'ColorScheme' ],
		} ),
		saveColorScheme: builder.mutation< 'system' | 'light' | 'dark', 'system' | 'light' | 'dark' >( {
			queryFn: async ( colorScheme ) => {
				await getIpcApi().saveColorScheme( colorScheme );
				return { data: colorScheme };
			},
			invalidatesTags: [ 'ColorScheme' ],
		} ),
		getQuitSitesBehavior: builder.query< QuitSitesBehavior | undefined, void >( {
			queryFn: async () => {
				const quitSitesBehavior = await getIpcApi().getQuitSitesBehavior();
				return { data: quitSitesBehavior };
			},
			providesTags: [ 'QuitSitesBehavior' ],
		} ),
		saveQuitSitesBehavior: builder.mutation<
			QuitSitesBehavior | undefined,
			QuitSitesBehavior | undefined
		>( {
			queryFn: async ( quitSitesBehavior ) => {
				await getIpcApi().saveQuitSitesBehavior( quitSitesBehavior );
				return { data: quitSitesBehavior };
			},
			invalidatesTags: [ 'QuitSitesBehavior' ],
		} ),
		getDefaultSiteDirectory: builder.query< string, void >( {
			queryFn: async () => {
				const directory = await getIpcApi().getDefaultSiteDirectory();
				return { data: directory };
			},
			providesTags: [ 'DefaultSiteDirectory' ],
		} ),
		saveDefaultSiteDirectory: builder.mutation< string, string >( {
			queryFn: async ( directory ) => {
				await getIpcApi().saveDefaultSiteDirectory( directory );
				return { data: directory };
			},
			invalidatesTags: [ 'DefaultSiteDirectory' ],
		} ),
		getAnalyticsEnabled: builder.query< boolean, void >( {
			queryFn: async () => {
				const enabled = await getIpcApi().getAnalyticsEnabled();
				return { data: enabled };
			},
			providesTags: [ 'AnalyticsEnabled' ],
		} ),
		saveAnalyticsEnabled: builder.mutation<
			boolean,
			{ enabled: boolean; surface: 'onboarding' | 'settings' }
		>( {
			queryFn: async ( { enabled, surface } ) => {
				await getIpcApi().saveAnalyticsEnabled( enabled, { surface, uiVersion: 'v1' } );
				return { data: enabled };
			},
			invalidatesTags: [ 'AnalyticsEnabled' ],
		} ),
	} ),
} );

export const {
	useGetInstalledAppsQuery,
	useGetUserEditorQuery,
	useGetUserTerminalQuery,
	useSaveUserEditorMutation,
	useSaveUserTerminalMutation,
	useGetStudioCliIsInstalledQuery,
	useSaveStudioCliIsInstalledMutation,
	useGetColorSchemeQuery,
	useSaveColorSchemeMutation,
	useGetQuitSitesBehaviorQuery,
	useSaveQuitSitesBehaviorMutation,
	useGetDefaultSiteDirectoryQuery,
	useSaveDefaultSiteDirectoryMutation,
	useGetAnalyticsEnabledQuery,
	useSaveAnalyticsEnabledMutation,
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
					[ terminal, terminalConfig[ terminal ].name() ] as [ SupportedTerminal, string ]
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
					[ terminal, terminalConfig[ terminal ].name() ] as [ SupportedTerminal, string ]
			);
	}
);
