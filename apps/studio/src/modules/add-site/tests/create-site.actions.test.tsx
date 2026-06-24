// To run tests, execute `npm run test -- src/modules/add-site/tests/create-site.actions.test.tsx` from the root directory
/**
 * Site Management UI integration tests — site creation (STU-1867).
 *
 * UI counterpart to apps/cli/commands/site/tests/create.e2e.test.ts (PR #3947). Mounts the
 * real AddSite modal + SiteDetailsProvider and mocks only the IPC bridge, then asserts the
 * exact `getIpcApi().createSite(path, config)` command each create flow generates — the
 * "what command does the UI fire" model agreed in the 6/24 testing huddle.
 *
 * The sibling add-site.test.tsx mocks `useSiteDetails` and asserts the modal -> hook call;
 * these run the real hook and assert the hook -> IPC command translation, so the full
 * user-flow -> command path is covered end to end.
 *
 * Smoke-sheet rows: Site Management #1 (suggested name), #2 (custom name),
 * #3 (default location), #4 (custom location), #5 (custom domain + HTTPS).
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ReactNode } from 'react';
import { Provider } from 'react-redux';
import { vi, beforeAll, beforeEach } from 'vitest';
import { ContentTabsProvider } from 'src/hooks/use-content-tabs';
import { SiteDetailsProvider } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';
import AddSite from 'src/modules/add-site';
import { store } from 'src/stores';

vi.mock( 'src/lib/get-ipc-api' );
vi.mock( 'src/lib/app-globals', () => ( {
	isWindows: () => false,
	isLinux: () => false,
} ) );
vi.mock( 'src/components/dot-grid', () => ( { DotGrid: () => null } ) );
vi.mock( 'src/hooks/use-offline', () => ( {
	useOffline: vi.fn().mockReturnValue( false ),
} ) );
vi.mock( 'src/hooks/use-import-export', () => ( {
	useImportExport: () => ( {
		importState: {},
		importFile: vi.fn(),
		clearImportState: vi.fn(),
	} ),
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
		useGetWordPressVersions: () => ( {
			data: [ { value: '6.4.0', isBeta: false, isDevelopment: false, label: '6.4' } ],
		} ),
		selectWordPressVersionsWithLatest: vi.fn(),
		selectLatestStableVersion: vi.fn(),
	};
} );
vi.mock( 'src/stores/wpcom-api', async () => {
	const actual = await vi.importActual( 'src/stores/wpcom-api' );
	return {
		...( actual || {} ),
		useGetBlueprints: vi.fn().mockReturnValue( {
			data: { blueprints: [], total: 0 },
			isLoading: false,
			refetch: vi.fn(),
			isUninitialized: false,
		} ),
	};
} );

const DEFAULT_PATH = '/default_path/my-wordpress-website';
const CUSTOM_PATH = '/custom/location';
const SUGGESTED_NAME = 'My WordPress Website';

const wrapper = ( { children }: { children: ReactNode } ) => (
	<Provider store={ store }>
		<ContentTabsProvider>
			<SiteDetailsProvider>{ children }</SiteDetailsProvider>
		</ContentTabsProvider>
	</Provider>
);

beforeAll( () => {
	Object.defineProperty( window, 'ipcListener', {
		value: { subscribe: vi.fn().mockReturnValue( () => {} ) },
		writable: true,
	} );
} );

beforeEach( () => {
	vi.clearAllMocks();
	vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
		// SiteDetailsProvider mount
		getSiteDetails: vi.fn().mockResolvedValue( [] ),
		getConnectedWpcomSites: vi.fn().mockResolvedValue( [] ),
		startServer: vi.fn().mockResolvedValue( undefined ),
		// AddSite / useAddSite mount + interaction
		generateProposedSitePath: vi.fn().mockResolvedValue( {
			path: DEFAULT_PATH,
			name: SUGGESTED_NAME,
			isEmpty: true,
			isWordPress: false,
		} ),
		generateSiteNameFromList: vi.fn().mockResolvedValue( SUGGESTED_NAME ),
		getAllCustomDomains: vi.fn().mockResolvedValue( [] ),
		showOpenFolderDialog: vi.fn().mockResolvedValue( {
			path: CUSTOM_PATH,
			name: SUGGESTED_NAME,
			isEmpty: true,
			isWordPress: false,
		} ),
		comparePaths: vi.fn().mockResolvedValue( false ),
		isCATrusted: vi.fn().mockResolvedValue( true ),
		setWindowControlVisibility: vi.fn(),
		setupAppMenu: vi.fn(),
		// Create command (assertion target) + success-callback notification
		createSite: vi.fn().mockImplementation( ( path: string ) =>
			Promise.resolve( {
				id: 'new-site',
				name: SUGGESTED_NAME,
				path,
				port: 8881,
				running: false,
			} )
		),
		showNotification: vi.fn(),
	} );
} );

function setup() {
	const user = userEvent.setup();
	render( <AddSite />, { wrapper } );
	return user;
}

// Drive the AddSite modal from the launcher button to the empty-site create form.
async function openCreateForm( user: ReturnType< typeof userEvent.setup > ) {
	await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
	await user.click( screen.getByTestId( 'create-site-option-button' ) );
	await user.click( await screen.findByRole( 'button', { name: /Empty site/ } ) );
	await user.click( screen.getByRole( 'button', { name: 'Continue' } ) );
}

async function submitForm( user: ReturnType< typeof userEvent.setup > ) {
	const dialog = screen.getByRole( 'dialog' );
	await user.click( within( dialog ).getByRole( 'button', { name: 'Add site' } ) );
}

describe( 'AddSite — create site (IPC command boundary)', () => {
	it( 'suggested name: createSite( _, { siteName: suggested } )', async () => {
		const user = setup();
		await openCreateForm( user );
		await submitForm( user );

		await waitFor( () => {
			expect( getIpcApi().createSite ).toHaveBeenCalledWith(
				expect.any( String ),
				expect.objectContaining( { siteName: SUGGESTED_NAME } )
			);
		} );
	} );

	it( 'default location: createSite( defaultPath, ... )', async () => {
		const user = setup();
		await openCreateForm( user );
		await submitForm( user );

		// With no folder picked, the site is created at the proposed default path.
		await waitFor( () => {
			expect( getIpcApi().createSite ).toHaveBeenCalledWith(
				DEFAULT_PATH,
				expect.objectContaining( { siteName: SUGGESTED_NAME } )
			);
		} );
	} );

	it( 'custom name: createSite( _, { siteName: custom } )', async () => {
		const user = setup();
		await openCreateForm( user );

		const nameInput = screen.getByDisplayValue( SUGGESTED_NAME );
		await user.clear( nameInput );
		await user.type( nameInput, 'My Custom Site' );
		await submitForm( user );

		await waitFor( () => {
			expect( getIpcApi().createSite ).toHaveBeenCalledWith(
				expect.any( String ),
				expect.objectContaining( { siteName: 'My Custom Site' } )
			);
		} );
	} );

	it( 'custom location: createSite( chosenPath, ... )', async () => {
		const user = setup();
		await openCreateForm( user );

		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );
		await user.click( screen.getByTestId( 'select-path-button' ) );
		await submitForm( user );

		await waitFor( () => {
			expect( getIpcApi().createSite ).toHaveBeenCalledWith(
				CUSTOM_PATH,
				expect.objectContaining( { siteName: SUGGESTED_NAME } )
			);
		} );
	} );

	it( 'custom domain + HTTPS: createSite( _, { customDomain, enableHttps: true } )', async () => {
		const user = setup();
		await openCreateForm( user );

		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );
		await user.click( screen.getByLabelText( 'Use custom domain' ) );
		// Set the controlled domain field in one shot: userEvent.type loops on this input
		// because its displayed value falls back to the generated domain until edited.
		fireEvent.change( screen.getByLabelText( 'Domain name' ), {
			target: { value: 'mysite.local' },
		} );
		await submitForm( user );

		// Enabling a custom domain with a trusted certificate auto-enables HTTPS.
		await waitFor( () => {
			expect( getIpcApi().createSite ).toHaveBeenCalledWith(
				expect.any( String ),
				expect.objectContaining( { customDomain: 'mysite.local', enableHttps: true } )
			);
		} );
	} );
} );
