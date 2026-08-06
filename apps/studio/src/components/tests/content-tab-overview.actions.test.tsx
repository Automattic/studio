// To run tests, execute `npm run test -- src/components/tests/content-tab-overview.actions.test.tsx` from the root directory
/**
 * Overview "Customize" link UI tests — the command each block-theme shortcut fires (STU-1875).
 *
 * Companion to the CLI e2e suite (overview-customize-links.e2e.test.ts): that
 * proves the Site Editor routes load; this proves the UI half the CLI can't —
 * that clicking each Customize button opens the right URL. Following the #3950
 * pattern, it mounts the real Site/ThemeDetails providers and mocks only the IPC
 * bridge, then asserts the exact `openSiteURL` command each click generates.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ReactNode } from 'react';
import { Provider } from 'react-redux';
import { beforeAll, beforeEach, vi } from 'vitest';
import { ContentTabOverview } from 'src/components/content-tab-overview';
import { ContentTabsProvider } from 'src/hooks/use-content-tabs';
import { SiteDetailsProvider } from 'src/hooks/use-site-details';
import { ThemeDetailsProvider } from 'src/hooks/use-theme-details';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { store } from 'src/stores';

vi.mock( 'src/lib/get-ipc-api' );
vi.mock( 'src/lib/app-globals', () => ( {
	isWindows: () => false,
	isLinux: () => false,
	getAppGlobals: () => ( { platform: 'darwin' } ),
} ) );
vi.mock( 'src/lib/file-manager', () => ( {
	getFileManagerLabel: () => 'Finder',
} ) );

const SITE_ID = 'site-id';
const site: StartedSiteDetails = {
	id: SITE_ID,
	name: 'Test Site',
	path: '/path/to/site',
	port: 8881,
	phpVersion: '8.4',
	running: true,
	url: 'http://localhost:8881',
	themeDetails: {
		name: 'Twenty Twenty-Five',
		path: '/path/to/theme',
		slug: 'twentytwentyfive',
		isBlockTheme: true,
		supportsWidgets: false,
		supportsMenus: false,
	},
};

// Each block-theme Customize button, the URL it opens, and the entry_point it
// reports to Tracks (content-tab-overview.tsx).
const CUSTOMIZE_LINKS = [
	{ label: 'Site Editor', url: '/wp-admin/site-editor.php', entryPoint: 'editor' },
	{
		label: 'Styles',
		url: '/wp-admin/site-editor.php?path=%2Fwp_global_styles',
		entryPoint: 'editor_styles',
	},
	{
		label: 'Patterns',
		url: '/wp-admin/site-editor.php?path=%2Fpatterns',
		entryPoint: 'editor_patterns',
	},
	{
		label: 'Navigation',
		url: '/wp-admin/site-editor.php?path=%2Fnavigation',
		entryPoint: 'editor_navigation',
	},
	{
		label: 'Templates',
		url: '/wp-admin/site-editor.php?path=%2Fwp_template',
		entryPoint: 'editor_templates',
	},
	{ label: 'Pages', url: '/wp-admin/site-editor.php?path=%2Fpage', entryPoint: 'editor_pages' },
];

const wrapper = ( { children }: { children: ReactNode } ) => (
	<Provider store={ store }>
		<ContentTabsProvider>
			<SiteDetailsProvider>
				<ThemeDetailsProvider>{ children }</ThemeDetailsProvider>
			</SiteDetailsProvider>
		</ContentTabsProvider>
	</Provider>
);

function renderOverview( selectedSite: SiteDetails = site ) {
	return render( <ContentTabOverview selectedSite={ selectedSite } />, { wrapper } );
}

// A Customize button is enabled only after the provider has loaded and the server
// is no longer marked as starting; wait for that before clicking.
async function findEnabledButton( label: string ) {
	return waitFor( () => {
		const button = screen.getByRole( 'button', { name: label } );
		expect( button ).toBeEnabled();
		return button;
	} );
}

beforeAll( () => {
	Object.defineProperty( window, 'ipcListener', {
		value: { subscribe: vi.fn().mockReturnValue( () => {} ) },
		writable: true,
	} );
} );

beforeEach( () => {
	vi.clearAllMocks();
	vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
		getSiteDetails: vi.fn().mockResolvedValue( [ site ] ),
		getConnectedWpcomSites: vi.fn().mockResolvedValue( [] ),
		getThumbnailData: vi.fn().mockResolvedValue( undefined ),
		getUserEditor: vi.fn().mockResolvedValue( undefined ),
		getUserTerminal: vi.fn().mockResolvedValue( undefined ),
		startServer: vi.fn().mockResolvedValue( { ...site, running: true } ),
		openSiteURL: vi.fn(),
		recordAnalyticsEvent: vi.fn().mockResolvedValue( undefined ),
	} );
} );

describe( 'ContentTabOverview — Customize links (IPC command boundary)', () => {
	it.each( CUSTOMIZE_LINKS )( '$label opens $url', async ( { label, url } ) => {
		const user = userEvent.setup();
		renderOverview();

		await user.click( await findEnabledButton( label ) );

		await waitFor( () => {
			expect( getIpcApi().openSiteURL ).toHaveBeenCalledWith( SITE_ID, url );
		} );
	} );

	it.each( CUSTOMIZE_LINKS )(
		'$label records a customize Tracks event with entry_point $entryPoint',
		async ( { label, entryPoint } ) => {
			const user = userEvent.setup();
			renderOverview();

			await user.click( await findEnabledButton( label ) );

			await waitFor( () => {
				expect( getIpcApi().recordAnalyticsEvent ).toHaveBeenCalledWith(
					'studio_site_open_customize',
					{ entry_point: entryPoint }
				);
			} );
		}
	);

	it( 'starts the server before opening when the site is stopped', async () => {
		const user = userEvent.setup();
		const stoppedSite: SiteDetails = { ...site, running: false };
		vi.mocked( getIpcApi().getSiteDetails ).mockResolvedValue( [ stoppedSite ] );

		renderOverview( stoppedSite );

		await user.click( await findEnabledButton( 'Site Editor' ) );

		await waitFor( () => {
			expect( getIpcApi().startServer ).toHaveBeenCalledWith( SITE_ID );
		} );
		await waitFor( () => {
			expect( getIpcApi().openSiteURL ).toHaveBeenCalledWith(
				SITE_ID,
				'/wp-admin/site-editor.php'
			);
		} );
	} );
} );
