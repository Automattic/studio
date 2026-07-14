// To run tests, execute `npm run test -- src/modules/site-settings/tests/edit-site-details.actions.test.tsx` from the root directory
/**
 * Site Management UI integration tests — edit settings & change PHP version (STU-1867).
 *
 * Unlike the sibling edit-site-details.test.tsx (which mocks `useSiteDetails` and asserts the
 * hook call), these mount the real `SiteDetailsProvider`, open the Edit Site modal for real,
 * and assert the exact `getIpcApi().updateSite(site, wpVersion)` command the save generates —
 * the "what command does the UI fire" model agreed in the 6/24 testing huddle. Changing the
 * PHP version was flagged flaky in the old Playwright suite (Redux/_events round-trip); asserting
 * at the IPC boundary sidesteps that.
 *
 * Smoke-sheet rows: Site Management #10 (edit settings — site name), #11 (change PHP version).
 */
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ReactNode } from 'react';
import { Provider } from 'react-redux';
import { vi, beforeAll, beforeEach } from 'vitest';
import { ContentTabsProvider } from 'src/hooks/use-content-tabs';
import { SiteDetailsProvider } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';
import EditSiteDetails from 'src/modules/site-settings/edit-site-details';
import { store } from 'src/stores';

vi.mock( 'src/lib/get-ipc-api' );
vi.mock( 'src/lib/app-globals', () => ( {
	isWindows: () => false,
	isLinux: () => false,
} ) );
vi.mock( 'src/hooks/use-offline', () => ( {
	useOffline: vi.fn().mockReturnValue( false ),
} ) );
vi.mock( 'src/stores/certificate-trust-api', async () => {
	const actual = await vi.importActual( 'src/stores/certificate-trust-api' );
	return {
		...( actual || {} ),
		useCheckCertificateTrustQuery: vi.fn().mockReturnValue( { data: true } ),
	};
} );
vi.mock( 'src/stores/wordpress-versions-api', async () => {
	const actual = await vi.importActual( 'src/stores/wordpress-versions-api' );
	return {
		...actual,
		useGetWordPressVersions: vi.fn( () => ( {
			data: [
				{ label: 'Latest', value: '6.7.2' },
				{ label: '6.4', value: '6.4', isBeta: false, isDevelopment: false },
			],
			isLoading: false,
		} ) ),
	};
} );

const SITE_ID = 'site-id';
const site: SiteDetails = {
	id: SITE_ID,
	name: 'Test Site',
	path: '/path/to/site',
	port: 8881,
	phpVersion: '8.4',
	running: false,
	autoStart: false,
	adminPassword: btoa( 'test-password' ),
};

const wrapper = ( { children }: { children: ReactNode } ) => (
	<Provider store={ store }>
		<ContentTabsProvider>
			<SiteDetailsProvider>{ children }</SiteDetailsProvider>
		</ContentTabsProvider>
	</Provider>
);

function setup() {
	const user = userEvent.setup();
	render( <EditSiteDetails currentWpVersion="6.4" onSave={ vi.fn() } />, { wrapper } );
	return user;
}

// Open the Edit Site modal and wait for it to render.
async function openEditModal( user: ReturnType< typeof userEvent.setup > ) {
	await waitFor( () => expect( getIpcApi().getAllCustomDomains ).toHaveBeenCalled() );
	await user.click( screen.getByRole( 'button', { name: 'Edit site' } ) );
	await screen.findByRole( 'dialog' );
}

// updateSite is called as updateSite( site, wpVersion ); assert on the persisted site arg.
function savedSiteArg() {
	return vi.mocked( getIpcApi().updateSite ).mock.calls[ 0 ][ 0 ];
}

beforeAll( () => {
	Object.defineProperty( window, 'ipcListener', {
		value: { subscribe: vi.fn().mockReturnValue( () => {} ) },
		writable: true,
	} );
} );

beforeEach( () => {
	vi.clearAllMocks();
	// Make the provider select our seeded site deterministically.
	localStorage.setItem( 'selectedSiteId', SITE_ID );
	vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
		getSiteDetails: vi.fn().mockResolvedValue( [ site ] ),
		getConnectedWpcomSites: vi.fn().mockResolvedValue( [] ),
		startServer: vi.fn().mockResolvedValue( undefined ),
		getAllCustomDomains: vi.fn().mockResolvedValue( [] ),
		getXdebugEnabledSite: vi.fn().mockResolvedValue( null ),
		executeWPCLiInline: vi.fn().mockResolvedValue( { stdout: '', stderr: '', exitCode: 0 } ),
		isCATrusted: vi.fn().mockResolvedValue( true ),
		// Save command (assertion target) — updateSite then re-reads the site list.
		updateSite: vi.fn().mockResolvedValue( undefined ),
		showNotification: vi.fn(),
	} );
} );

describe( 'EditSiteDetails — save (IPC command boundary)', () => {
	it( 'edit settings: fires updateSite with the renamed site', async () => {
		const user = setup();
		await openEditModal( user );

		const nameInput = screen.getByLabelText( 'Site name' );
		await user.clear( nameInput );
		await user.type( nameInput, 'Renamed Site' );
		await user.click( screen.getByRole( 'button', { name: 'Save' } ) );

		await waitFor( () => expect( getIpcApi().updateSite ).toHaveBeenCalled() );
		expect( savedSiteArg() ).toMatchObject( { id: SITE_ID, name: 'Renamed Site' } );
	} );

	it( 'change PHP version: fires updateSite with the new phpVersion', async () => {
		const user = setup();
		await openEditModal( user );

		await user.selectOptions( screen.getByLabelText( 'PHP version' ), '8.2' );
		await user.click( screen.getByRole( 'button', { name: 'Save' } ) );

		await waitFor( () => expect( getIpcApi().updateSite ).toHaveBeenCalled() );
		expect( savedSiteArg() ).toMatchObject( { id: SITE_ID, phpVersion: '8.2' } );
	} );
} );
