import { render, waitFor, screen, within, fireEvent } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { vi } from 'vitest';
import { useOffline } from 'src/hooks/use-offline';
import { FolderDialogResponse } from 'src/ipc-handlers';
import { createTestStore } from 'src/lib/test-utils';
import AddSite from 'src/modules/add-site';
import { useGetBlueprints } from 'src/stores/wpcom-api';

vi.mock( 'src/stores/certificate-trust-api', async () => {
	const actual = await vi.importActual( 'src/stores/certificate-trust-api' );
	return {
		...( actual || {} ),
		useCheckCertificateTrustQuery: vi.fn().mockReturnValue( { data: true } ),
	};
} );

vi.mock( 'src/lib/app-globals', () => ( {
	isWindows: () => false,
	isLinux: () => false,
} ) );

vi.mock( 'src/components/dot-grid', () => ( {
	DotGrid: () => null,
} ) );

vi.mock( 'src/stores/wordpress-versions-api', async () => {
	const actual = await vi.importActual( 'src/stores/wordpress-versions-api' );
	return {
		...( actual || {} ),
		useGetWordPressVersions: () => ( {
			data: [
				{
					value: '6.5.0-beta1',
					isBeta: true,
					isDevelopment: false,
					label: '6.5.0-beta1',
				},
				{ value: '6.4.0', isBeta: false, isDevelopment: false, label: '6.4' },
				{ value: '6.3.3', isBeta: false, isDevelopment: false, label: '6.3.3' },
			],
		} ),
		selectWordPressVersionsWithLatest: vi.fn(),
		selectLatestStableVersion: vi.fn(),
	};
} );

const mockShowOpenFolderDialog =
	vi.fn< ( dialogTitle: string ) => Promise< FolderDialogResponse | null > >();
const mockGenerateProposedSitePath =
	vi.fn< ( siteName: string ) => Promise< FolderDialogResponse > >();
const mockGetAllCustomDomains = vi.fn< () => Promise< string[] > >().mockResolvedValue( [] );
const mockSetSelectedTab = vi.fn();

vi.mock( 'src/lib/get-ipc-api', () => ( {
	__esModule: true,
	default: vi.fn(),
	getIpcApi: () => ( {
		isCATrusted: vi.fn( () => Promise.resolve( true ) ),
		showOpenFolderDialog: mockShowOpenFolderDialog,
		generateProposedSitePath: mockGenerateProposedSitePath,
		generateSiteNameFromList: vi.fn( () => Promise.resolve( 'My WordPress Website' ) ),
		getAllCustomDomains: mockGetAllCustomDomains,
		setWindowControlVisibility: vi.fn(),
		setupAppMenu: vi.fn(),
	} ),
} ) );

vi.mock( 'src/hooks/use-import-export', () => ( {
	useImportExport: () => ( {
		importState: {},
		importFile: vi.fn(),
		clearImportState: vi.fn(),
	} ),
} ) );

vi.mock( 'src/hooks/use-content-tabs', () => ( {
	useContentTabs: () => ( {
		selectedTab: 'overview',
		setSelectedTab: mockSetSelectedTab,
		tabs: [],
	} ),
} ) );

const mockCreateSite = vi.fn< ( path: string, name?: string, wpVersion?: string ) => void >();
vi.mock( 'src/hooks/use-site-details', () => ( {
	useSiteDetails: () => ( {
		createSite: mockCreateSite,
		sites: [],
	} ),
} ) );

vi.mock( 'src/hooks/use-offline', () => ( {
	useOffline: vi.fn().mockReturnValue( false ),
} ) );

vi.mock( 'src/stores/wpcom-api', async () => {
	const actual = await vi.importActual( 'src/stores/wpcom-api' );
	return {
		...( actual || {} ),
		useGetBlueprints: vi.fn().mockReturnValue( {
			data: {
				blueprints: [],
				total: 0,
			},
			isLoading: false,
			refetch: vi.fn(),
			isUninitialized: false,
		} ),
	};
} );

const renderWithProvider = ( children: React.ReactElement ) => {
	const store = createTestStore();
	return render( <Provider store={ store }>{ children }</Provider> );
};

beforeEach( () => {
	vi.clearAllMocks();

	mockSetSelectedTab.mockReset();

	mockShowOpenFolderDialog.mockResolvedValue( {
		path: 'test',
		name: 'test',
		isEmpty: true,
		isWordPress: false,
	} );

	mockGenerateProposedSitePath.mockResolvedValue( {
		path: '/default_path/my-wordpress-website',
		name: 'My WordPress Website',
		isEmpty: true,
		isWordPress: false,
	} );
} );

describe( 'AddSite', () => {
	beforeEach( () => {} );

	it( 'should dismiss the modal when the close button is activated via keyboard', async () => {
		const user = userEvent.setup();
		mockGenerateProposedSitePath.mockResolvedValue( {
			path: '/default_path/my-wordpress-website',
			name: 'My WordPress Website',
			isEmpty: true,
			isWordPress: false,
		} );
		renderWithProvider( <AddSite /> );

		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
		await user.click( screen.getByRole( 'heading', { name: 'Add a site' } ) );

		// Find the Close button
		const closeButton = screen.getByRole( 'button', { name: 'Close' } );
		expect( closeButton ).toBeInTheDocument();

		// Tab until we reach the Closes button
		let currentButton;
		do {
			await user.tab();
			currentButton = document.activeElement;
		} while ( currentButton !== closeButton );

		await user.keyboard( '{Enter}' );
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		expect( mockCreateSite ).not.toHaveBeenCalled();
	} );

	it( 'calls createSite with selected path when create a site button is clicked', async () => {
		const user = userEvent.setup();
		mockGenerateProposedSitePath.mockResolvedValue( {
			path: '/default_path/my-wordpress-website',
			name: 'My WordPress Website',
			isEmpty: true,
			isWordPress: false,
		} );

		mockShowOpenFolderDialog.mockResolvedValue( {
			path: 'test',
			name: 'test',
			isEmpty: true,
			isWordPress: false,
		} );
		renderWithProvider( <AddSite /> );

		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
		expect( screen.getByRole( 'dialog' ) ).toBeVisible();

		await user.click( screen.getByTestId( 'create-site-option-button' ) );
		await user.click( await screen.findByRole( 'button', { name: /Empty site/ } ) );
		await user.click( screen.getByRole( 'button', { name: 'Continue' } ) );

		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );
		await user.click( screen.getByTestId( 'select-path-button' ) );

		expect( mockShowOpenFolderDialog ).toHaveBeenCalledWith( 'Choose folder for site', '' );

		// The stepper's "Add site" button uses requestSubmit() which jsdom doesn't support.
		// Directly fire the form's submit event instead.
		const form = document.querySelector( 'form' )!;
		fireEvent.submit( form );

		expect( mockCreateSite ).toHaveBeenCalledTimes( 1 );
		expect( mockCreateSite ).toHaveBeenCalledWith(
			'test',
			'My WordPress Website',
			'latest',
			undefined,
			false,
			expect.objectContaining( { slug: 'empty' } ),
			'8.4',
			expect.any( Function ),
			false,
			'admin',
			expect.any( String ),
			'admin@localhost.com',
			'native-php',
			'site-directory',
			undefined // flowType
		);
	} );

	it( 'should display an error informing the user if the selected site folder does not contain a WordPress site', async () => {
		const user = userEvent.setup();
		mockGenerateProposedSitePath.mockResolvedValue( {
			path: '/default_path/my-wordpress-website',
			name: 'My WordPress Website',
			isEmpty: true,
			isWordPress: false,
		} );
		mockShowOpenFolderDialog.mockResolvedValue( {
			path: 'test',
			name: 'test',
			isEmpty: false,
			isWordPress: false,
		} );
		renderWithProvider( <AddSite /> );

		await user.click( screen.getAllByRole( 'button', { name: 'Add site' } )[ 0 ] );
		expect( screen.getByRole( 'dialog' ) ).toBeVisible();

		await user.click( screen.getByTestId( 'create-site-option-button' ) );
		await user.click( await screen.findByRole( 'button', { name: /Empty site/ } ) );
		await user.click( screen.getByRole( 'button', { name: 'Continue' } ) );

		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );
		await user.click( screen.getByTestId( 'select-path-button' ) );

		expect( mockShowOpenFolderDialog ).toHaveBeenCalledWith( 'Choose folder for site', '' );

		await waitFor( () => {
			const dialog = screen.getByRole( 'dialog' );
			const addSiteButton = within( dialog ).getByRole( 'button', { name: 'Add site' } );
			expect( addSiteButton ).toBeDisabled();
			expect( screen.getByRole( 'alert' ) ).toHaveTextContent(
				'This directory is not empty. Please select an empty directory or an existing WordPress folder.'
			);
		} );
	} );

	it( 'should display a warning informing the user that the folder is not empty', async () => {
		const user = userEvent.setup();
		mockGenerateProposedSitePath.mockResolvedValue( {
			path: '/default_path/my-wordpress-website',
			name: 'My WordPress Website',
			isEmpty: true,
			isWordPress: false,
		} );

		mockShowOpenFolderDialog.mockResolvedValue( {
			path: 'test',
			name: 'test',
			isEmpty: false,
			isWordPress: true,
		} );
		renderWithProvider( <AddSite /> );

		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
		expect( screen.getByRole( 'dialog' ) ).toBeVisible();

		await user.click( screen.getByTestId( 'create-site-option-button' ) );
		await user.click( await screen.findByRole( 'button', { name: /Empty site/ } ) );
		await user.click( screen.getByRole( 'button', { name: 'Continue' } ) );

		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );
		await user.click( screen.getByTestId( 'select-path-button' ) );

		expect( mockShowOpenFolderDialog ).toHaveBeenCalledWith( 'Choose folder for site', '' );

		await waitFor( () => {
			const dialog = screen.getByRole( 'dialog' );
			const addSiteButton = within( dialog ).getByRole( 'button', { name: 'Add site' } );
			expect( addSiteButton ).toBeEnabled();
			expect( screen.getByRole( 'alert' ) ).toHaveTextContent(
				'The existing WordPress site at this path will be added.'
			);
		} );
	} );

	it( 'should discard prior mutations and generate a new proposed site path everytime the modal is opened', async () => {
		const user = userEvent.setup();
		mockGenerateProposedSitePath.mockImplementation( ( name ) => {
			const path = `/default_path/${ name.replace( /\s/g, '-' ).toLowerCase() }`;
			return Promise.resolve( {
				path,
				name,
				isEmpty: true,
				isWordPress: false,
			} );
		} );
		renderWithProvider( <AddSite /> );

		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
		expect( screen.getByRole( 'dialog' ) ).toBeVisible();

		await user.click( screen.getByTestId( 'create-site-option-button' ) );
		await user.click( await screen.findByRole( 'button', { name: /Empty site/ } ) );
		await user.click( screen.getByRole( 'button', { name: 'Continue' } ) );

		const siteNameInput = screen.getByDisplayValue( 'My WordPress Website' );
		await user.click( siteNameInput );
		await user.type( siteNameInput, ' changed' );

		expect( screen.getByDisplayValue( 'My WordPress Website changed' ) ).toBeVisible();
		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );
		expect( screen.getByText( '/default_path/my-wordpress-website-changed' ) ).toBeVisible();

		await user.keyboard( '{Escape}' );
		await waitFor( () => {
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		} );
		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
		expect( screen.getByRole( 'dialog' ) ).toBeVisible();

		await user.click( screen.getByTestId( 'create-site-option-button' ) );
		await user.click( await screen.findByRole( 'button', { name: /Empty site/ } ) );
		await user.click( screen.getByRole( 'button', { name: 'Continue' } ) );

		expect( screen.getByDisplayValue( 'My WordPress Website' ) ).toBeVisible();
		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );
		expect( screen.getByText( '/default_path/my-wordpress-website' ) ).toBeVisible();
	} );

	it( 'should reset to the proposed path when the path is set to default app directory', async () => {
		const user = userEvent.setup();
		mockGenerateProposedSitePath.mockImplementation( ( name ) => {
			const path = `/default_path/${ name.replace( /\s/g, '-' ).toLowerCase() }`;
			return Promise.resolve( {
				path,
				name,
				isEmpty: true,
				isWordPress: false,
			} );
		} );
		mockShowOpenFolderDialog.mockResolvedValue( {
			path: 'populated-non-wordpress-directory',
			name: 'My WordPress Website',
			isEmpty: false,
			isWordPress: false,
		} );
		renderWithProvider( <AddSite /> );

		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );

		await user.click( screen.getByTestId( 'create-site-option-button' ) );
		await user.click( await screen.findByRole( 'button', { name: /Empty site/ } ) );
		await user.click( screen.getByRole( 'button', { name: 'Continue' } ) );

		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );
		await user.click( screen.getByTestId( 'select-path-button' ) );

		mockShowOpenFolderDialog.mockResolvedValue( {
			path: '/default_path',
			name: 'My WordPress Website',
			isEmpty: false,
			isWordPress: false,
		} );
		await user.click( screen.getByTestId( 'select-path-button' ) );
		await user.click( screen.getByDisplayValue( 'My WordPress Website' ) );
		await user.type( screen.getByDisplayValue( 'My WordPress Website' ), ' mutated' );

		expect( screen.getByText( '/default_path/my-wordpress-website-mutated' ) ).toBeVisible();
	} );

	it( 'should display WordPress version dropdown', async () => {
		const user = userEvent.setup();
		mockGenerateProposedSitePath.mockResolvedValue( {
			path: '/default_path/my-wordpress-website',
			name: 'My WordPress Website',
			isEmpty: true,
			isWordPress: false,
		} );

		renderWithProvider( <AddSite /> );

		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );

		await user.click( screen.getByTestId( 'create-site-option-button' ) );
		await user.click( await screen.findByRole( 'button', { name: /Empty site/ } ) );
		await user.click( screen.getByRole( 'button', { name: 'Continue' } ) );

		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );

		expect( screen.getByText( 'WordPress version' ) ).toBeInTheDocument();

		const comboboxes = screen.getAllByRole( 'combobox' );
		expect( comboboxes.length ).toBeGreaterThanOrEqual( 2 );

		const wpVersionDropdown = comboboxes[ 1 ];
		expect( wpVersionDropdown ).toBeInTheDocument();

		await user.selectOptions( wpVersionDropdown, '6.3.3' );

		mockShowOpenFolderDialog.mockResolvedValue( {
			path: 'test',
			name: 'test',
			isEmpty: true,
			isWordPress: false,
		} );
		await user.click( screen.getByTestId( 'select-path-button' ) );

		const form = document.querySelector( 'form' )!;
		fireEvent.submit( form );

		expect( mockCreateSite ).toHaveBeenCalledWith(
			'test',
			'My WordPress Website',
			'6.3.3',
			undefined,
			false,
			expect.objectContaining( { slug: 'empty' } ),
			'8.4',
			expect.any( Function ),
			false,
			'admin',
			expect.any( String ),
			'admin@localhost.com',
			'native-php',
			'site-directory',
			undefined // flowType
		);
	} );

	it( 'should allow selecting the runtime and file access', async () => {
		const user = userEvent.setup();
		mockGenerateProposedSitePath.mockResolvedValue( {
			path: '/default_path/my-wordpress-website',
			name: 'My WordPress Website',
			isEmpty: true,
			isWordPress: false,
		} );

		renderWithProvider( <AddSite /> );

		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
		await user.click( screen.getByTestId( 'create-site-option-button' ) );
		await user.click( await screen.findByRole( 'button', { name: /Empty site/ } ) );
		await user.click( screen.getByRole( 'button', { name: 'Continue' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );

		// Native is the default, so File access is selectable; switching to the
		// sandbox disables it (the sandbox only sees the site directory).
		expect( screen.getByLabelText( 'File access' ) ).toBeEnabled();
		await user.selectOptions( screen.getByLabelText( 'PHP runtime' ), 'playground' );
		expect( screen.getByLabelText( 'File access' ) ).toBeDisabled();
		await user.selectOptions( screen.getByLabelText( 'PHP runtime' ), 'native-php' );
		await user.selectOptions( screen.getByLabelText( 'File access' ), 'all-files' );

		mockShowOpenFolderDialog.mockResolvedValue( {
			path: 'test',
			name: 'test',
			isEmpty: true,
			isWordPress: false,
		} );
		await user.click( screen.getByTestId( 'select-path-button' ) );
		const dialog = screen.getByRole( 'dialog' );
		await user.click( within( dialog ).getByRole( 'button', { name: 'Add site' } ) );

		await waitFor( () => {
			expect( mockCreateSite ).toHaveBeenCalledWith(
				'test',
				'My WordPress Website',
				'latest',
				undefined,
				false,
				expect.objectContaining( { slug: 'empty' } ),
				'8.4',
				expect.any( Function ),
				false,
				'admin',
				expect.any( String ),
				'admin@localhost.com',
				'native-php',
				'all-files',
				undefined // flowType
			);
		} );
	} );

	it( 'should allow selecting a different PHP version', async () => {
		const user = userEvent.setup();
		mockGenerateProposedSitePath.mockResolvedValue( {
			path: '/default_path/my-wordpress-website',
			name: 'My WordPress Website',
			isEmpty: true,
			isWordPress: false,
		} );

		renderWithProvider( <AddSite /> );

		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );

		await user.click( screen.getByTestId( 'create-site-option-button' ) );
		await user.click( await screen.findByRole( 'button', { name: /Empty site/ } ) );
		await user.click( screen.getByRole( 'button', { name: 'Continue' } ) );

		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );

		expect( screen.getByText( 'PHP version' ) ).toBeInTheDocument();

		const comboboxes = screen.getAllByRole( 'combobox' );
		expect( comboboxes.length ).toBeGreaterThanOrEqual( 2 );

		const phpVersionDropdown = comboboxes[ 0 ];
		expect( phpVersionDropdown ).toBeInTheDocument();

		await user.selectOptions( phpVersionDropdown, '8.2' );

		mockShowOpenFolderDialog.mockResolvedValue( {
			path: 'test',
			name: 'test',
			isEmpty: true,
			isWordPress: false,
		} );
		await user.click( screen.getByTestId( 'select-path-button' ) );
		const dialog = screen.getByRole( 'dialog' );
		const addSiteButton = within( dialog ).getByRole( 'button', { name: 'Add site' } );
		await user.click( addSiteButton );

		await waitFor( () => {
			expect( mockCreateSite ).toHaveBeenCalled();
		} );
	} );

	it( 'should disable WordPress version field when offline', async () => {
		vi.mocked( useOffline ).mockReturnValue( true );

		renderWithProvider( <AddSite /> );
		const user = userEvent.setup();

		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
		await user.click( screen.getByTestId( 'create-site-option-button' ) );
		await user.click( await screen.findByRole( 'button', { name: /Empty site/ } ) );
		await user.click( screen.getByRole( 'button', { name: 'Continue' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );

		const wpVersionSelect = screen.getByLabelText( 'WordPress version' );
		expect( wpVersionSelect ).toBeDisabled();
	} );

	it( 'should enable WordPress version field when online', async () => {
		vi.mocked( useOffline ).mockReturnValue( false );

		renderWithProvider( <AddSite /> );
		const user = userEvent.setup();

		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
		await user.click( screen.getByTestId( 'create-site-option-button' ) );
		await user.click( await screen.findByRole( 'button', { name: /Empty site/ } ) );
		await user.click( screen.getByRole( 'button', { name: 'Continue' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );

		const wpVersionSelect = screen.getByLabelText( 'WordPress version' );
		expect( wpVersionSelect ).toBeEnabled();
	} );

	it( 'should show tooltip with offline message when hovering over disabled WordPress version field', async () => {
		vi.mocked( useOffline ).mockReturnValue( true );

		renderWithProvider( <AddSite /> );
		const user = userEvent.setup();

		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
		await user.click( screen.getByTestId( 'create-site-option-button' ) );
		await user.click( await screen.findByRole( 'button', { name: /Empty site/ } ) );
		await user.click( screen.getByRole( 'button', { name: 'Continue' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );

		const wpVersionSelect = screen.getByLabelText( 'WordPress version' );
		await user.hover( wpVersionSelect );

		expect(
			screen.getByText(
				'You are currently offline so your site will be created with the latest version. Selecting a different WordPress version requires an internet connection.'
			)
		).toBeInTheDocument();
	} );

	it( 'should not show tooltip when hovering over WordPress version field while online', async () => {
		vi.mocked( useOffline ).mockReturnValue( false );

		renderWithProvider( <AddSite /> );
		const user = userEvent.setup();

		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
		await user.click( screen.getByTestId( 'create-site-option-button' ) );
		await user.click( await screen.findByRole( 'button', { name: /Empty site/ } ) );
		await user.click( screen.getByRole( 'button', { name: 'Continue' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );

		const wpVersionSelect = screen.getByLabelText( 'WordPress version' );
		await user.hover( wpVersionSelect );

		expect(
			screen.queryByText(
				'You are currently offline so your site will be created with the latest version. Selecting a different WordPress version requires an internet connection.'
			)
		).not.toBeInTheDocument();
	} );

	it( 'should show warning immediately when Blueprint preferred versions differ from selected versions', async () => {
		const mockBlueprintData = {
			data: {
				blueprints: [
					{
						slug: 'quick-start',
						title: 'Test Blueprint',
						excerpt: 'A test blueprint',
						image: '',
						playground_url: '',
						blueprint: {
							preferredVersions: {
								php: '7.1',
								wp: '6.2.0',
							},
						},
					},
				],
				total: 1,
			},
			isLoading: false,
			refetch: vi.fn(),
			isUninitialized: false,
		};

		vi.mocked( useGetBlueprints, { partial: true } ).mockReturnValue( mockBlueprintData );

		renderWithProvider( <AddSite /> );
		const user = userEvent.setup();

		// Open modal and navigate to blueprint selection
		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
		await user.click( screen.getByTestId( 'create-site-option-button' ) );

		// Select the blueprint with preferred versions
		await user.click( await screen.findByRole( 'button', { name: /Test Blueprint/ } ) );

		// Continue to create site form
		await user.click( screen.getByRole( 'button', { name: 'Continue' } ) );
		console.error( 'DEBUG BP: clicked Continue' );

		// Open advanced settings to access version selectors
		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );
		console.error( 'DEBUG BP: clicked Advanced settings' );
		console.error(
			'DEBUG BP: warning text found:',
			!! screen.queryByText( 'Version differs from Blueprint recommendation' )
		);

		await waitFor( () => {
			expect(
				screen.getByText( 'Version differs from Blueprint recommendation' )
			).toBeInTheDocument();
			expect( screen.getByText( 'PHP 7.1 (selected is 8.4)' ) ).toBeInTheDocument();
			expect( screen.getByText( 'WordPress 6.2.0 (selected is latest)' ) ).toBeInTheDocument();
		} );

		// Warning indicator should show next to Advanced settings
		await waitFor( () => {
			expect( screen.getByText( '2 warnings found' ) ).toBeInTheDocument();
		} );
	} );

	it( 'should not show warning when versions match blueprint preferred versions', async () => {
		const mockBlueprintData = {
			data: {
				blueprints: [
					{
						slug: 'quick-start',
						title: 'Test Blueprint 2',
						excerpt: 'Another test blueprint',
						image: '',
						playground_url: '',
						blueprint: {
							preferredVersions: {
								php: '8.4', // Same as default in store
								wp: 'latest',
							},
						},
					},
				],
				total: 1,
			},
			isLoading: false,
			refetch: vi.fn(),
			isUninitialized: false,
		};

		vi.mocked( useGetBlueprints, { partial: true } ).mockReturnValue( mockBlueprintData );

		renderWithProvider( <AddSite /> );
		const user = userEvent.setup();

		// Open modal and navigate to blueprint selection
		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
		await user.click( screen.getByTestId( 'create-site-option-button' ) );

		// Select the blueprint
		await user.click( await screen.findByRole( 'button', { name: /Test Blueprint 2/ } ) );

		// Continue to create site form
		await user.click( screen.getByRole( 'button', { name: 'Continue' } ) );

		// Open advanced settings
		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );

		// Should not show warning since versions match preferred versions
		expect(
			screen.queryByText( 'Version differs from Blueprint recommendation' )
		).not.toBeInTheDocument();
	} );
} );
