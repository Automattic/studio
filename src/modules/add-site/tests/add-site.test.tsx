// Run tests: yarn test -- src/components/add-site-button.test.tsx
import { jest } from '@jest/globals';
import { render, waitFor, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { useOffline } from 'src/hooks/use-offline';
import { FolderDialogResponse } from 'src/ipc-handlers';
import { createTestStore } from 'src/lib/test-utils';
import AddSite from 'src/modules/add-site';

jest.mock( 'src/stores/certificate-trust-api', () => {
	const actual = jest.requireActual( 'src/stores/certificate-trust-api' ) || {};
	return {
		...actual,
		useCheckCertificateTrustQuery: jest.fn().mockReturnValue( { data: true } ),
	};
} );

jest.mock( 'src/lib/app-globals', () => ( {
	isWindows: () => false,
} ) );

jest.mock( 'src/stores/wordpress-versions-api', () => {
	const actual = jest.requireActual( 'src/stores/wordpress-versions-api' ) || {};
	return {
		...actual,
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
		selectWordPressVersionsWithLatest: jest.fn(),
		selectLatestStableVersion: jest.fn(),
	};
} );

const mockShowOpenFolderDialog =
	jest.fn< ( dialogTitle: string ) => Promise< FolderDialogResponse | null > >();
const mockGenerateProposedSitePath =
	jest.fn< ( siteName: string ) => Promise< FolderDialogResponse > >();
const mockGetAllCustomDomains = jest.fn< () => Promise< string[] > >().mockResolvedValue( [] );

jest.mock( 'src/lib/get-ipc-api', () => ( {
	__esModule: true,
	default: jest.fn(),
	getIpcApi: () => ( {
		isCATrusted: jest.fn( () => Promise.resolve( true ) ),
		showOpenFolderDialog: mockShowOpenFolderDialog,
		generateProposedSitePath: mockGenerateProposedSitePath,
		getAllCustomDomains: mockGetAllCustomDomains,
	} ),
} ) );

const mockCreateSite = jest.fn< ( path: string, name?: string, wpVersion?: string ) => void >();
jest.mock( 'src/hooks/use-site-details', () => ( {
	useSiteDetails: () => ( {
		createSite: mockCreateSite,
		data: [],
	} ),
} ) );

jest.mock( 'src/hooks/use-offline', () => ( {
	useOffline: jest.fn().mockReturnValue( false ),
} ) );

jest.mock( 'src/stores/wpcom-api', () => {
	const actual = jest.requireActual( 'src/stores/wpcom-api' ) || {};
	return {
		...actual,
		useGetBlueprints: jest.fn().mockReturnValue( {
			data: {
				blueprints: [],
				total: 0,
			},
			isLoading: false,
			refetch: jest.fn(),
			isUninitialized: false,
		} ),
	};
} );

const renderWithProvider = ( children: React.ReactElement ) => {
	const store = createTestStore( {
		providerConstants: {
			defaultPhpVersion: '8.3',
			defaultWordPressVersion: 'latest',
			allowedPhpVersions: [ '8.0', '8.1', '8.2', '8.3' ],
		},
	} );
	return render( <Provider store={ store }>{ children }</Provider> );
};

beforeEach( () => {
	jest.clearAllMocks();

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
	beforeEach( () => {
		jest.clearAllMocks();
	} );

	it( 'should dismiss the modal when the cancel button is activated via keyboard', async () => {
		const user = userEvent.setup();
		mockGenerateProposedSitePath.mockResolvedValue( {
			path: '/default_path/my-wordpress-website',
			name: 'My WordPress Website',
			isEmpty: true,
			isWordPress: false,
		} );
		renderWithProvider( <AddSite /> );

		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );

		// Find the Cancel button
		const cancelButton = screen.getByRole( 'button', { name: 'Cancel' } );
		expect( cancelButton ).toBeInTheDocument();

		// Tab until we reach the Cancel button
		let currentButton;
		do {
			await user.tab();
			currentButton = document.activeElement;
		} while ( currentButton !== cancelButton );

		await user.keyboard( '{Enter}' );
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		expect( mockCreateSite ).not.toHaveBeenCalled();
	} );

	it( 'calls createSite with selected path when add site button is clicked', async () => {
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
		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );
		await user.click( screen.getByTestId( 'select-path-button' ) );

		expect( mockShowOpenFolderDialog ).toHaveBeenCalledWith( 'Choose folder for site', '' );
		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );

		await waitFor( () => {
			expect( mockCreateSite ).toHaveBeenCalledWith(
				'test',
				'My WordPress Website',
				'latest',
				undefined,
				false,
				null, // blueprint parameter
				expect.any( Function )
			);
		} );
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

		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
		expect( screen.getByRole( 'dialog' ) ).toBeVisible();
		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );
		await user.click( screen.getByTestId( 'select-path-button' ) );

		expect( mockShowOpenFolderDialog ).toHaveBeenCalledWith( 'Choose folder for site', '' );

		await waitFor( () => {
			expect( screen.getByRole( 'button', { name: 'Add site' } ) ).toBeDisabled();
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
		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );
		await user.click( screen.getByTestId( 'select-path-button' ) );

		expect( mockShowOpenFolderDialog ).toHaveBeenCalledWith( 'Choose folder for site', '' );

		await waitFor( () => {
			expect( screen.getByRole( 'button', { name: 'Add site' } ) ).not.toBeDisabled();
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

		const siteNameInput = screen.getByDisplayValue( 'My WordPress Website' );
		await user.click( siteNameInput );
		await user.type( siteNameInput, ' changed' );

		expect( screen.getByDisplayValue( 'My WordPress Website changed' ) ).toBeVisible();
		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );
		expect(
			screen.getByDisplayValue( '/default_path/my-wordpress-website-changed' )
		).toBeVisible();

		await user.keyboard( '{Escape}' );
		await waitFor( () => {
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		} );
		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
		expect( screen.getByRole( 'dialog' ) ).toBeVisible();
		expect( screen.getByDisplayValue( 'My WordPress Website' ) ).toBeVisible();
		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );
		expect( screen.getByDisplayValue( '/default_path/my-wordpress-website' ) ).toBeVisible();
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

		expect(
			screen.getByDisplayValue( '/default_path/my-wordpress-website-mutated' )
		).toBeVisible();
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
		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );

		await waitFor( () => {
			expect( mockCreateSite ).toHaveBeenCalledWith(
				'test',
				'My WordPress Website',
				'6.3.3',
				undefined,
				false,
				null, // blueprint parameter
				expect.any( Function )
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
		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );

		await waitFor( () => {
			expect( mockCreateSite ).toHaveBeenCalled();
		} );
	} );

	it( 'should disable WordPress version field when offline', async () => {
		( useOffline as jest.Mock ).mockReturnValue( true );

		renderWithProvider( <AddSite /> );
		const user = userEvent.setup();

		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );

		const wpVersionSelect = screen.getByLabelText( 'WordPress version' );
		expect( wpVersionSelect ).toBeDisabled();
	} );

	it( 'should enable WordPress version field when online', async () => {
		( useOffline as jest.Mock ).mockReturnValue( false );

		renderWithProvider( <AddSite /> );
		const user = userEvent.setup();

		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );

		const wpVersionSelect = screen.getByLabelText( 'WordPress version' );
		expect( wpVersionSelect ).not.toBeDisabled();
	} );

	it( 'should show tooltip with offline message when hovering over disabled WordPress version field', async () => {
		( useOffline as jest.Mock ).mockReturnValue( true );

		renderWithProvider( <AddSite /> );
		const user = userEvent.setup();

		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
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
		( useOffline as jest.Mock ).mockReturnValue( false );

		renderWithProvider( <AddSite /> );
		const user = userEvent.setup();

		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );

		const wpVersionSelect = screen.getByLabelText( 'WordPress version' );
		await user.hover( wpVersionSelect );

		expect(
			screen.queryByText(
				'You are currently offline so your site will be created with the latest version. Selecting a different WordPress version requires an internet connection.'
			)
		).not.toBeInTheDocument();
	} );
} );
