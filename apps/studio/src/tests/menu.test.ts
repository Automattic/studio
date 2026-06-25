/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupMenu } from 'src/menu';
import type { MenuItemConstructorOptions } from 'electron';

const electronMock = vi.hoisted( () => ( {
	buildFromTemplate: vi.fn(),
	setApplicationMenu: vi.fn(),
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
		buildFromTemplate: electronMock.buildFromTemplate,
		setApplicationMenu: electronMock.setApplicationMenu,
	},
	MenuItem: vi.fn(),
	shell: {
		openPath: vi.fn( async () => '' ),
	},
} ) );

vi.mock( 'src/main-window', () => ( {
	getMainWindow: vi.fn().mockResolvedValue( {
		isAlwaysOnTop: vi.fn().mockReturnValue( false ),
		isDestroyed: vi.fn().mockReturnValue( false ),
		setMenu: vi.fn(),
	} ),
	loadMainWindowRenderer: vi.fn(),
} ) );

vi.mock( 'src/about-menu/open-about-menu', () => ( {
	openAboutWindow: vi.fn(),
} ) );

vi.mock( 'src/updates', () => ( {
	isUpdateReadyToInstall: vi.fn().mockReturnValue( false ),
	manualCheckForUpdates: vi.fn(),
} ) );

vi.mock( 'src/lib/beta-features', () => ( {
	getBetaFeatures: vi.fn().mockResolvedValue( {} ),
	getBetaFeaturesDefinition: vi.fn().mockReturnValue( {} ),
	updateBetaFeature: vi.fn(),
} ) );

vi.mock( 'src/lib/bump-stats', () => ( {
	bumpStat: vi.fn(),
	getPlatformMetric: vi.fn().mockReturnValue( 'macos' ),
	StatsGroup: {
		STUDIO_APP_DOLLY_DISABLE: 'studio_app_dolly_disable',
		STUDIO_APP_DOLLY_ENABLE: 'studio_app_dolly_enable',
	},
} ) );

vi.mock( 'src/ipc-utils', () => ( {
	sendIpcEventToRenderer: vi.fn(),
} ) );

function getViewMenuLabels() {
	const template = electronMock.buildFromTemplate.mock.calls.at( -1 )?.[ 0 ] as
		| MenuItemConstructorOptions[]
		| undefined;
	const viewMenu = template?.find( ( item ) => item.role === 'viewMenu' );
	const submenu = viewMenu?.submenu as MenuItemConstructorOptions[] | undefined;

	return submenu?.map( ( item ) => item.label ).filter( Boolean ) ?? [];
}

describe( 'menu', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		delete process.env.ENABLE_AGENTIC_UI;
		electronMock.buildFromTemplate.mockReturnValue( { popup: vi.fn() } );
	} );

	afterEach( () => {
		delete process.env.ENABLE_AGENTIC_UI;
	} );

	it( 'hides the site preview menu item when the agentic UI is disabled', async () => {
		await setupMenu( { needsOnboarding: false } );

		expect( getViewMenuLabels() ).not.toContain( 'Toggle Site Preview' );
	} );

	it( 'shows the site preview menu item when the agentic UI is enabled', async () => {
		process.env.ENABLE_AGENTIC_UI = 'true';

		await setupMenu( { needsOnboarding: false } );

		expect( getViewMenuLabels() ).toContain( 'Toggle Site Preview' );
	} );
} );
