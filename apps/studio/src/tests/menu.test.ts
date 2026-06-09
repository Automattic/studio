/**
 * @vitest-environment node
 */
import { Menu } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMainWindowRenderer } from 'src/main-window';
import { setupMenu } from 'src/menu';
import { saveUserData } from 'src/storage/user-data';

type TestMenuItem = {
	accelerator?: string;
	checked?: boolean;
	click?: ( menuItem: { checked: boolean } ) => Promise< void > | void;
	enabled?: boolean;
	label?: string;
	submenu?: TestMenuItem[];
	sublabel?: string;
	type?: string;
};

const mocks = vi.hoisted( () => ( {
	getMainWindow: vi.fn(),
	getPreferredStudioUiMode: vi.fn(),
	loadMainWindowRenderer: vi.fn(),
	loadUserData: vi.fn(),
	lockAppdata: vi.fn(),
	saveUserData: vi.fn(),
	unlockAppdata: vi.fn(),
	getBetaFeatures: vi.fn(),
	getBetaFeaturesDefinition: vi.fn(),
	updateBetaFeature: vi.fn(),
	sendIpcEventToRenderer: vi.fn(),
} ) );

vi.mock( 'electron', () => ( {
	app: {
		name: 'Studio',
	},
	autoUpdater: {
		quitAndInstall: vi.fn(),
	},
	BrowserWindow: vi.fn(),
	Menu: {
		buildFromTemplate: vi.fn( ( template ) => template ),
		setApplicationMenu: vi.fn(),
	},
	MenuItem: vi.fn(),
	shell: {
		openPath: vi.fn(),
	},
} ) );

vi.mock( '@wordpress/i18n', () => ( {
	__: ( text: string ) => text,
} ) );

vi.mock( 'src/about-menu/open-about-menu', () => ( {
	openAboutWindow: vi.fn(),
} ) );

vi.mock( 'src/ipc-utils', () => ( {
	sendIpcEventToRenderer: mocks.sendIpcEventToRenderer,
} ) );

vi.mock( 'src/lib/beta-features', () => ( {
	getBetaFeatures: mocks.getBetaFeatures,
	getBetaFeaturesDefinition: mocks.getBetaFeaturesDefinition,
	updateBetaFeature: mocks.updateBetaFeature,
} ) );

vi.mock( 'src/lib/bump-stats', () => ( {
	bumpStat: vi.fn(),
	getPlatformMetric: vi.fn(),
	StatsGroup: {
		STUDIO_APP_DOLLY_DISABLE: 'dolly-disable',
		STUDIO_APP_DOLLY_ENABLE: 'dolly-enable',
	},
} ) );

vi.mock( 'src/lib/feature-flags', () => ( {
	FEATURE_FLAGS: {},
	getFeatureFlagFromEnv: vi.fn(),
	setFeatureFlagInEnv: vi.fn(),
} ) );

vi.mock( 'src/lib/get-localized-link', () => ( {
	getLocalizedLink: vi.fn(),
} ) );

vi.mock( 'src/lib/locale-node', () => ( {
	getUserLocaleWithFallback: vi.fn(),
} ) );

vi.mock( 'src/lib/shell-open-external-wrapper', () => ( {
	shellOpenExternalWrapper: vi.fn(),
} ) );

vi.mock( 'src/lib/windows-helpers', () => ( {
	promptWindowsSpeedUpSites: vi.fn(),
} ) );

vi.mock( 'src/logging', () => ( {
	getLogsFilePath: vi.fn(),
} ) );

vi.mock( 'src/main-window', () => ( {
	getMainWindow: mocks.getMainWindow,
	getPreferredStudioUiMode: mocks.getPreferredStudioUiMode,
	loadMainWindowRenderer: mocks.loadMainWindowRenderer,
} ) );

vi.mock( 'src/storage/user-data', () => ( {
	loadUserData: mocks.loadUserData,
	lockAppdata: mocks.lockAppdata,
	saveUserData: mocks.saveUserData,
	unlockAppdata: mocks.unlockAppdata,
} ) );

vi.mock( 'src/updates', () => ( {
	isUpdateReadyToInstall: vi.fn( () => false ),
	manualCheckForUpdates: vi.fn(),
} ) );

function getMenuTemplate() {
	return vi.mocked( Menu.buildFromTemplate ).mock.calls[ 0 ][ 0 ] as TestMenuItem[];
}

function getBetaFeaturesSubmenu() {
	const appMenu = getMenuTemplate()[ 0 ];
	return appMenu.submenu?.find( ( item ) => item.label === 'Beta Features' )
		?.submenu as TestMenuItem[];
}

function getPlatformBetaFeatureLabel( label: string, description: string ) {
	return process.platform === 'win32' ? description : label;
}

function getPlatformBetaFeatureSublabel( description: string ) {
	return process.platform === 'darwin' ? description : undefined;
}

function getViewSubmenu() {
	const viewMenu = getMenuTemplate().find( ( item ) => item.label === 'View' );
	return viewMenu?.submenu as TestMenuItem[];
}

describe( 'app menu', () => {
	const mainWindow = {
		close: vi.fn(),
		isAlwaysOnTop: vi.fn( () => false ),
		isDestroyed: vi.fn( () => false ),
		setAlwaysOnTop: vi.fn(),
		setMenu: vi.fn(),
	};

	beforeEach( () => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		mocks.getMainWindow.mockResolvedValue( mainWindow );
		mocks.getPreferredStudioUiMode.mockReturnValue( 'agentic' );
		mocks.loadUserData.mockResolvedValue( { desks: { defaultUiMode: 'agentic' } } );
		mocks.getBetaFeatures.mockResolvedValue( {
			nativePhpRuntime: false,
			remoteSession: false,
		} );
		mocks.getBetaFeaturesDefinition.mockReturnValue( {} );
	} );

	afterEach( () => {
		vi.useRealTimers();
	} );

	it( 'adds a single Agentic UI checkbox to the Beta Features menu', async () => {
		await setupMenu( { needsOnboarding: false } );

		const submenu = getBetaFeaturesSubmenu();

		expect( submenu ).toHaveLength( 1 );
		expect( submenu[ 0 ] ).toMatchObject( {
			checked: true,
			label: getPlatformBetaFeatureLabel( 'Agentic UI', 'Use the new agentic Studio interface.' ),
			sublabel: getPlatformBetaFeatureSublabel(
				'Use a new AI agent focused interface for managing and editing your sites.'
			),
			type: 'checkbox',
		} );
	} );

	it( 'keeps Agentic UI with the other beta options', async () => {
		mocks.getBetaFeaturesDefinition.mockReturnValue( {
			remoteSession: {
				description: 'Control Studio from Telegram via the remote-session daemon.',
				label: 'Remote Session',
			},
		} );

		await setupMenu( { needsOnboarding: false } );

		const submenu = getBetaFeaturesSubmenu();

		expect( submenu.map( ( item ) => item.label ) ).toEqual( [
			getPlatformBetaFeatureLabel( 'Agentic UI', 'Use the new agentic Studio interface.' ),
			getPlatformBetaFeatureLabel(
				'Remote Session',
				'Control Studio from Telegram via the remote-session daemon.'
			),
		] );
		expect( submenu.some( ( item ) => item.type === 'separator' ) ).toBe( false );
	} );

	it( 'persists default UI mode when Agentic UI is unchecked', async () => {
		await setupMenu( { needsOnboarding: false } );

		const agenticUiItem = getBetaFeaturesSubmenu()[ 0 ];
		expect( agenticUiItem.click ).toBeDefined();

		await agenticUiItem.click?.( { checked: false } );
		vi.runAllTimers();

		expect( saveUserData ).toHaveBeenCalledWith( {
			desks: { defaultUiMode: 'default' },
		} );
		expect( loadMainWindowRenderer ).toHaveBeenCalledWith( mainWindow, 'default' );
	} );

	it( 'adds a View menu item for toggling site preview', async () => {
		await setupMenu( { needsOnboarding: false } );

		const toggleItem = getViewSubmenu().find( ( item ) => item.label === 'Toggle Site Preview' );

		expect( toggleItem ).toMatchObject( {
			accelerator: 'CommandOrControl+Shift+B',
			enabled: true,
		} );

		await toggleItem?.click?.( { checked: false } );

		expect( mocks.sendIpcEventToRenderer ).toHaveBeenCalledWith( 'toggle-site-preview' );
	} );
} );
