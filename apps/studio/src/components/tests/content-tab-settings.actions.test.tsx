// To run tests, execute `npm run test -- src/components/tests/content-tab-settings.actions.test.tsx` from the root directory
/**
 * Site Management UI integration tests — duplicate & delete (STU-1867).
 *
 * Part of migrating apps/studio/e2e/sites.test.ts to fast jsdom tests. Unlike the
 * sibling content-tab-settings.test.tsx (which mocks `useSiteDetails`), these mount
 * the real `SiteDetailsProvider` and mock only the IPC bridge, then assert the exact
 * `getIpcApi()` command a user interaction generates — the "what command does the UI
 * fire" model agreed in the 6/24 testing huddle. Duplicate has no CLI command, so this
 * is its primary automated coverage; the old e2e delete tests were skipped on Windows.
 *
 * Smoke-sheet rows: Site Management #9 (duplicate), #12 (delete, keep dir), #13 (delete, +dir).
 */
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ReactNode } from 'react';
import { Provider } from 'react-redux';
import { vi, beforeAll, beforeEach } from 'vitest';
import { ContentTabSettings } from 'src/components/content-tab-settings';
import { ContentTabsProvider } from 'src/hooks/use-content-tabs';
import { SiteDetailsProvider } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { store } from 'src/stores';

vi.mock( 'src/lib/get-ipc-api' );
vi.mock( 'src/lib/app-globals', () => ( {
	isWindows: () => false,
	isLinux: () => false,
} ) );
vi.mock( 'src/hooks/use-get-wp-version', () => ( {
	useGetWpVersion: () => [ '6.5', vi.fn() ],
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
			data: [ { label: 'Latest', value: 'latest', isBeta: false, isDevelopment: false } ],
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

function renderSettings() {
	return render( <ContentTabSettings selectedSite={ site } />, { wrapper } );
}

async function openMoreOptions( user: ReturnType< typeof userEvent.setup > ) {
	await user.click( screen.getByRole( 'button', { name: 'More options' } ) );
}

// Wait until the provider has finished its initial async site load before interacting.
async function waitForMount() {
	await waitFor( () => expect( getIpcApi().getAllCustomDomains ).toHaveBeenCalled() );
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
		// SiteDetailsProvider + ContentTabSettings/EditSiteDetails mount-time calls
		getSiteDetails: vi.fn().mockResolvedValue( [ site ] ),
		getConnectedWpcomSites: vi.fn().mockResolvedValue( [] ),
		startServer: vi.fn().mockResolvedValue( undefined ),
		getAllCustomDomains: vi.fn().mockResolvedValue( [] ),
		getXdebugEnabledSite: vi.fn().mockResolvedValue( null ),
		executeWPCLiInline: vi.fn().mockResolvedValue( { stdout: '', stderr: '', exitCode: 0 } ),
		isCATrusted: vi.fn().mockResolvedValue( true ),
		// Duplicate
		generateNumberedNameFromList: vi.fn().mockResolvedValue( 'Test Site Copy' ),
		copySite: vi.fn().mockResolvedValue( { ...site, id: 'new-site-id', name: 'Test Site Copy' } ),
		showNotification: vi.fn(),
		// Delete — default to "Cancel" so unrelated tests can't accidentally delete.
		showMessageBox: vi.fn().mockResolvedValue( { response: 1, checkboxChecked: false } ),
		deleteSite: vi.fn().mockResolvedValue( undefined ),
	} );
} );

describe( 'ContentTabSettings — site actions (IPC command boundary)', () => {
	it( 'duplicate: fires copySite with the source id and "<name> Copy" name', async () => {
		const user = userEvent.setup();
		renderSettings();
		await waitForMount();

		await openMoreOptions( user );
		await user.click( await screen.findByRole( 'menuitem', { name: 'Duplicate site' } ) );

		await waitFor( () => {
			expect( getIpcApi().copySite ).toHaveBeenCalledWith(
				SITE_ID,
				expect.any( String ),
				'Test Site Copy'
			);
		} );
	} );

	it( 'delete (+dir): fires deleteSite(id, true) when the files checkbox is checked', async () => {
		const user = userEvent.setup();
		vi.mocked( getIpcApi().showMessageBox ).mockResolvedValue( {
			response: 0,
			checkboxChecked: true,
		} );
		renderSettings();
		await waitForMount();

		await openMoreOptions( user );
		await user.click( await screen.findByRole( 'menuitem', { name: 'Delete site' } ) );

		await waitFor( () => {
			expect( getIpcApi().deleteSite ).toHaveBeenCalledWith( SITE_ID, true );
		} );
	} );

	it( 'delete (keep dir): fires deleteSite(id, false) when the files checkbox is unchecked', async () => {
		const user = userEvent.setup();
		vi.mocked( getIpcApi().showMessageBox ).mockResolvedValue( {
			response: 0,
			checkboxChecked: false,
		} );
		renderSettings();
		await waitForMount();

		await openMoreOptions( user );
		await user.click( await screen.findByRole( 'menuitem', { name: 'Delete site' } ) );

		await waitFor( () => {
			expect( getIpcApi().deleteSite ).toHaveBeenCalledWith( SITE_ID, false );
		} );
	} );

	it( 'delete (cancelled): does not fire deleteSite when the dialog is dismissed', async () => {
		const user = userEvent.setup();
		// showMessageBox already defaults to the Cancel response (index 1).
		renderSettings();
		await waitForMount();

		await openMoreOptions( user );
		await user.click( await screen.findByRole( 'menuitem', { name: 'Delete site' } ) );

		await waitFor( () => {
			expect( getIpcApi().showMessageBox ).toHaveBeenCalled();
		} );
		expect( getIpcApi().deleteSite ).not.toHaveBeenCalled();
	} );
} );
