import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import { SupportedLocale } from '@studio/common/lib/locale';
import { defaultI18n } from '@wordpress/i18n';
import { I18nProvider } from '@wordpress/react-i18n';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Provider as ReduxProvider } from 'react-redux';
import AuthProvider from 'src/components/auth-provider';
import { ColorSystemReference } from 'src/components/new-ui/color-system-reference';
import { ComponentLibrary } from 'src/components/new-ui/component-library';
import { StudioComponentLibrary } from 'src/components/new-ui/studio-component-library';
import { Toolbar } from 'src/components/new-ui/toolbar';
import { WordPressStyles } from 'src/components/wordpress-styles';
import { useAuth } from 'src/hooks/use-auth';
import { useOffline } from 'src/hooks/use-offline';
import { getAppGlobals, isWindowsStore } from 'src/lib/app-globals';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { McpSettings } from 'src/modules/mcp/components/mcp-settings';
import { AccountTab as AccountTabContent } from 'src/modules/user-settings/components/account-tab';
import { ColorSchemePicker } from 'src/modules/user-settings/components/color-scheme-picker';
import { EditorPicker } from 'src/modules/user-settings/components/editor-picker';
import { LanguagePicker } from 'src/modules/user-settings/components/language-picker';
import { SkillsTab } from 'src/modules/user-settings/components/skills-tab';
import { StudioCliToggle } from 'src/modules/user-settings/components/studio-cli-toggle';
import { TerminalPicker } from 'src/modules/user-settings/components/terminal-picker';
import { SupportedEditor } from 'src/modules/user-settings/lib/editor';
import { SupportedTerminal } from 'src/modules/user-settings/lib/terminal';
import { store, useAppDispatch, useI18nLocale, useRootSelector } from 'src/stores';
import { initializeUserLocale, saveUserLocale } from 'src/stores/i18n-slice';
import {
	useGetColorSchemeQuery,
	useGetStudioCliIsInstalledQuery,
	useGetUserEditorQuery,
	useGetUserTerminalQuery,
	useSaveColorSchemeMutation,
	useSaveStudioCliIsInstalledMutation,
	useSaveUserEditorMutation,
	useSaveUserTerminalMutation,
} from 'src/stores/installed-apps-api';
import { snapshotSelectors } from 'src/stores/snapshot-slice';
import { useDeleteAllSnapshots, useGetSnapshotUsage } from 'src/stores/wpcom-api';
import 'src/index.css';

const emotionCache = createCache( {
	key: 'wordpress-components',
	prepend: true,
} );

type SettingsTab =
	| 'general'
	| 'account'
	| 'skills'
	| 'mcp'
	| 'automattician'
	| 'colors'
	| 'components'
	| 'studio-components';

function GeneralTab() {
	const dispatch = useAppDispatch();
	const savedLocale = useI18nLocale();

	const { data: colorScheme } = useGetColorSchemeQuery();
	const { data: editor } = useGetUserEditorQuery();
	const { data: terminal } = useGetUserTerminalQuery();
	const { data: isCliInstalled } = useGetStudioCliIsInstalledQuery();

	const [ saveColorScheme ] = useSaveColorSchemeMutation();
	const [ saveEditor ] = useSaveUserEditorMutation();
	const [ saveTerminal ] = useSaveUserTerminalMutation();
	const [ saveCliIsInstalled ] = useSaveStudioCliIsInstalledMutation();

	const handleColorSchemeChange = useCallback(
		( scheme: 'system' | 'light' | 'dark' ) => {
			void saveColorScheme( scheme );
		},
		[ saveColorScheme ]
	);

	const handleLocaleChange = useCallback(
		( locale: SupportedLocale ) => {
			void dispatch( saveUserLocale( locale ) );
		},
		[ dispatch ]
	);

	const handleEditorChange = useCallback(
		( value: SupportedEditor | null ) => {
			if ( value ) {
				void saveEditor( value );
			}
		},
		[ saveEditor ]
	);

	const handleTerminalChange = useCallback(
		( value: SupportedTerminal ) => {
			void saveTerminal( value );
		},
		[ saveTerminal ]
	);

	const handleCliToggle = useCallback(
		( value: boolean ) => {
			void saveCliIsInstalled( value );
		},
		[ saveCliIsInstalled ]
	);

	return (
		<div className="flex flex-col gap-6">
			<ColorSchemePicker value={ colorScheme ?? 'light' } onChange={ handleColorSchemeChange } />
			<LanguagePicker value={ savedLocale ?? 'en' } onChange={ handleLocaleChange } />
			<div className="grid grid-cols-2 gap-3">
				<EditorPicker
					value={ editor ?? null }
					onChange={ handleEditorChange }
					disabled={ editor === undefined }
				/>
				<TerminalPicker value={ terminal ?? 'terminal' } onChange={ handleTerminalChange } />
			</div>
			{ ! isWindowsStore() && (
				<StudioCliToggle value={ isCliInstalled ?? false } onChange={ handleCliToggle } />
			) }
		</div>
	);
}

function AccountTab() {
	const { user } = useAuth();
	const snapshotsByUser = useRootSelector( ( state ) =>
		snapshotSelectors.selectSnapshotsByUser( state, user?.id ?? 0 )
	);
	const snapshotQuota = useRootSelector( ( state ) => state.snapshot.snapshotQuota );
	const { data: snapshotUsage, isLoading: isLoadingSnapshotUsage } = useGetSnapshotUsage();
	const definitiveSnapshotCount = snapshotUsage?.siteCount ?? snapshotsByUser?.length ?? 0;

	const [ deleteAllSnapshots, { isLoading: isDeletingAllSnapshots } ] = useDeleteAllSnapshots();

	const isOffline = useOffline();
	const { __ } = defaultI18n;

	const onRemoveSnapshots = useCallback( async () => {
		const CANCEL_BUTTON_INDEX = 0;
		const DELETE_BUTTON_INDEX = 1;

		const { response } = await getIpcApi().showMessageBox( {
			type: 'warning',
			message: __( 'Delete all preview sites' ),
			detail: __(
				'All preview sites that exist for your WordPress.com account, along with all posts, pages, comments, and media, will be lost.'
			),
			buttons: [ __( 'Cancel' ), __( 'Delete all' ) ],
			cancelId: CANCEL_BUTTON_INDEX,
		} );

		if ( response === DELETE_BUTTON_INDEX ) {
			try {
				await deleteAllSnapshots().unwrap();
			} catch {
				await getIpcApi().showMessageBox( {
					type: 'warning',
					message: __( 'Failed to delete all preview sites' ),
					detail: __( 'An error occurred while deleting all preview sites. Please try again.' ),
					buttons: [ __( 'OK' ) ],
				} );
			}
		}
	}, [ __, deleteAllSnapshots ] );

	return (
		<AccountTabContent
			loadingDeletingAllSnapshots={ isDeletingAllSnapshots }
			activeSnapshotCount={ definitiveSnapshotCount }
			isLoadingSnapshotUsage={ isLoadingSnapshotUsage }
			isOffline={ isOffline }
			snapshotQuota={ snapshotQuota }
			onRemoveSnapshots={ onRemoveSnapshots }
		/>
	);
}

const DEV_PLATFORM_KEY = 'devPlatform';

const PLATFORMS: { key: NodeJS.Platform; label: string }[] = [
	{ key: 'darwin', label: 'macOS' },
	{ key: 'win32', label: 'Windows' },
];

function setDevPlatform( p: NodeJS.Platform ) {
	window.appGlobals = { ...window.appGlobals, platform: p };
	localStorage.setItem( DEV_PLATFORM_KEY, p );
	window.dispatchEvent( new Event( 'dev-platform-change' ) );
}

function AutomattticianTab() {
	const [ platform, setPlatform ] = useState< NodeJS.Platform >( getAppGlobals().platform );

	const handlePlatformChange = ( p: NodeJS.Platform ) => {
		setDevPlatform( p );
		setPlatform( p );
	};

	return (
		<div className="flex flex-col gap-6">
			<div>
				<h3 className="a8c-subtitle-small text-chrome-text mb-3">Platform</h3>
				<p className="a8c-body text-chrome-text-secondary mb-3">
					Override the detected platform for UI testing.
				</p>
				<div className="flex gap-2">
					{ PLATFORMS.map( ( p ) => (
						<button
							key={ p.key }
							onClick={ () => handlePlatformChange( p.key ) }
							className={ cx(
								'px-3 py-1.5 rounded-md border a8c-body transition-colors',
								platform === p.key
									? 'border-frame-theme bg-frame-theme/10 text-frame-theme'
									: 'border-chrome-border text-chrome-text hover:bg-chrome-surface'
							) }
						>
							{ p.label }
						</button>
					) ) }
				</div>
			</div>
		</div>
	);
}

const TABS: { key: SettingsTab; label: string; devOnly?: boolean }[] = [
	{ key: 'general', label: 'General' },
	{ key: 'account', label: 'Account' },
	{ key: 'skills', label: 'Skills' },
	{ key: 'mcp', label: 'MCP' },
	{ key: 'automattician', label: 'Automattician', devOnly: true },
	{ key: 'colors', label: 'Colors', devOnly: true },
	{ key: 'components', label: 'WP Components', devOnly: true },
	{ key: 'studio-components', label: 'Studio Components', devOnly: true },
];

const isDev = process.env.NODE_ENV === 'development';
const visibleTabs = TABS.filter( ( tab ) => ! tab.devOnly || isDev );

function getInitialTab(): SettingsTab {
	const param = new URLSearchParams( window.location.search ).get( 'tab' );
	if ( param && TABS.some( ( t ) => t.key === param ) ) {
		return param as SettingsTab;
	}
	return 'general';
}

function SettingsContent() {
	const [ activeTab, setActiveTab ] = useState< SettingsTab >( getInitialTab );

	const tabContent = useMemo( () => {
		switch ( activeTab ) {
			case 'general':
				return <GeneralTab />;
			case 'account':
				return <AccountTab />;
			case 'skills':
				return <SkillsTab />;
			case 'mcp':
				return <McpSettings />;
			case 'automattician':
				return <AutomattticianTab />;
			case 'colors':
				return <ColorSystemReference />;
			case 'components':
				return <ComponentLibrary />;
			case 'studio-components':
				return <StudioComponentLibrary />;
		}
	}, [ activeTab ] );

	return (
		<>
			<div className="bg-chrome">
				<Toolbar
					className="app-drag-region"
					middle={ <span className="a8c-subtitle-small text-chrome-text">Settings</span> }
				/>
			</div>
			<div className={ cx( 'h-screen bg-chrome flex flex-col app-drag-region select-none' ) }>
				<div className="flex flex-1 min-h-0">
					{ /* Sidebar nav */ }
					<div className="w-[180px] flex-shrink-0 flex flex-col p-3">
						<nav className="flex flex-col gap-1 app-no-drag-region">
							{ visibleTabs.map( ( tab ) => (
								<button
									key={ tab.key }
									onClick={ () => setActiveTab( tab.key ) }
									className={ cx(
										'px-2 py-1.5 rounded-md a8c-body text-left transition-colors',
										activeTab === tab.key
											? 'bg-chrome-surface text-chrome-text font-medium'
											: 'text-chrome-text-secondary hover:text-chrome-text hover:bg-chrome-surface'
									) }
								>
									{ tab.label }
								</button>
							) ) }
						</nav>
					</div>

					{ /* Content */ }
					<div className="flex-1 flex flex-col min-h-0">
						<div className="flex-1 overflow-y-auto app-no-drag-region p-3">{ tabContent }</div>
					</div>
				</div>
			</div>
		</>
	);
}

export default function SettingsRoot() {
	useEffect( () => {
		void store.dispatch( initializeUserLocale() );
	}, [] );

	return (
		<CacheProvider value={ emotionCache }>
			<ReduxProvider store={ store }>
				<I18nProvider i18n={ defaultI18n }>
					<WordPressStyles />
					<AuthProvider>
						<SettingsContent />
					</AuthProvider>
				</I18nProvider>
			</ReduxProvider>
		</CacheProvider>
	);
}
