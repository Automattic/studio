/**
 * @vitest-environment node
 */
import { Menu } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMainWindowRenderer } from 'src/main-window';
import { setupMenu } from 'src/menu';

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
	loadMainWindowRenderer: vi.fn(),
	getBetaFeatures: vi.fn(),
	getBetaFeaturesDefinition: vi.fn(),
	updateBetaFeature: vi.fn(),
	getFeatureFlagFromEnv: vi.fn(),
	setFeatureFlagInEnv: vi.fn(),
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
	FEATURE_FLAGS: {
		enableBlueprints: { label: 'Enable Blueprints', flag: 'enableBlueprints' },
		enableAgenticUi: { label: 'Enable Agentic UI', flag: 'enableAgenticUi' },
		enableDesksUi: { label: 'Enable Desks UI', flag: 'enableDesksUi' },
	},
	getFeatureFlagFromEnv: mocks.getFeatureFlagFromEnv,
	setFeatureFlagInEnv: mocks.setFeatureFlagInEnv,
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
	loadMainWindowRenderer: mocks.loadMainWindowRenderer,
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

function getFeatureFlagsSubmenu() {
	const appMenu = getMenuTemplate()[ 0 ];
	return appMenu.submenu?.find( ( item ) => item.label === 'Feature Flags' )
		?.submenu as TestMenuItem[];
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
		vi.stubEnv( 'NODE_ENV', 'development' );
		mocks.getMainWindow.mockResolvedValue( mainWindow );
		mocks.getFeatureFlagFromEnv.mockReturnValue( false );
		mocks.getBetaFeatures.mockResolvedValue( {
			nativePhpRuntime: false,
			remoteSession: false,
		} );
		mocks.getBetaFeaturesDefinition.mockReturnValue( {
			remoteSession: {
				description: 'Control Studio from Telegram via the remote-session daemon.',
				label: 'Remote Session',
			},
		} );
	} );

	afterEach( () => {
		vi.unstubAllEnvs();
		vi.useRealTimers();
	} );

	it( 'lists beta features without any UI mode toggles', async () => {
		await setupMenu( { needsOnboarding: false } );

		const submenu = getBetaFeaturesSubmenu();

		expect( submenu ).toHaveLength( 1 );
		expect( submenu[ 0 ] ).toMatchObject( {
			checked: false,
			label: getPlatformBetaFeatureLabel(
				'Remote Session',
				'Control Studio from Telegram via the remote-session daemon.'
			),
			sublabel: getPlatformBetaFeatureSublabel(
				'Control Studio from Telegram via the remote-session daemon.'
			),
			type: 'checkbox',
		} );
	} );

	it( 'lists the Agentic UI and Desks UI feature flags', async () => {
		await setupMenu( { needsOnboarding: false } );

		const submenu = getFeatureFlagsSubmenu();

		expect( submenu.map( ( item ) => item.label ) ).toEqual( [
			'Enable Blueprints',
			'Enable Agentic UI',
			'Enable Desks UI',
		] );
	} );

	it( 'reloads the renderer when a UI mode feature flag is toggled', async () => {
		await setupMenu( { needsOnboarding: false } );

		const agenticUiItem = getFeatureFlagsSubmenu()[ 1 ];
		expect( agenticUiItem.click ).toBeDefined();

		await agenticUiItem.click?.( { checked: true } );
		vi.runAllTimers();

		expect( mocks.setFeatureFlagInEnv ).toHaveBeenCalledWith( 'enableAgenticUi', true );
		expect( loadMainWindowRenderer ).toHaveBeenCalledWith( mainWindow );
	} );

	it( 'does not reload the renderer when other feature flags are toggled', async () => {
		await setupMenu( { needsOnboarding: false } );

		const blueprintsItem = getFeatureFlagsSubmenu()[ 0 ];
		await blueprintsItem.click?.( { checked: false } );
		vi.runAllTimers();

		expect( mocks.setFeatureFlagInEnv ).toHaveBeenCalledWith( 'enableBlueprints', false );
		expect( loadMainWindowRenderer ).not.toHaveBeenCalled();
	} );

	it( 'does not reload the renderer when beta features are toggled', async () => {
		await setupMenu( { needsOnboarding: false } );

		const remoteSessionItem = getBetaFeaturesSubmenu()[ 0 ];
		await remoteSessionItem.click?.( { checked: true } );
		vi.runAllTimers();

		expect( mocks.updateBetaFeature ).toHaveBeenCalledWith( 'remoteSession', true );
		expect( loadMainWindowRenderer ).not.toHaveBeenCalled();
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
