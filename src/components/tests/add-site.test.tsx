// Run tests: yarn test -- src/components/add-site-button.test.tsx
import { jest } from '@jest/globals';
import { render, waitFor, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import AddSite from 'src/components/add-site';
import { useOffline } from 'src/hooks/use-offline';
import { FolderDialogResponse } from 'src/ipc-handlers';

jest.mock( 'src/lib/app-globals', () => ( {
	isWindows: () => false,
} ) );

jest.mock( 'src/stores', () => {
	const mockDispatch = jest.fn();
	return {
		useAppDispatch: jest.fn().mockReturnValue( mockDispatch ),
		useRootSelector: jest.fn().mockImplementation( ( selector ) => {
			if ( ! ( typeof selector === 'object' && selector !== null ) ) {
				return { status: 'succeeded' };
			}
			if ( 'name' in selector && selector.name === 'selectWordPressVersionsWithLatest' ) {
				return [
					{ isBeta: false, label: '6.4', value: '6.4.3' },
					{ isBeta: false, label: '6.3', value: '6.3.3' },
				];
			}
			if ( 'name' in selector && selector.name === 'selectLatestStableVersion' ) {
				return { isBeta: false, label: '6.4', value: '6.4.3' };
			}
			return { status: 'succeeded' };
		} ),
	};
} );

jest.mock( 'src/stores/wordpress-versions-slice', () => ( {
	wordpressVersionsSelectors: {
		selectWordPressVersionsWithLatest: { name: 'selectWordPressVersionsWithLatest' },
		selectLatestStableVersion: { name: 'selectLatestStableVersion' },
	},
	wordpressVersionsThunks: {
		fetchWordPressVersions: jest.fn(),
	},
} ) );

const mockShowOpenFolderDialog =
	jest.fn< ( dialogTitle: string ) => Promise< FolderDialogResponse | null > >();
const mockGenerateProposedSitePath =
	jest.fn< ( siteName: string ) => Promise< FolderDialogResponse > >();
const mockGetAllCustomDomains = jest.fn< () => Promise< string[] > >().mockResolvedValue( [] );

jest.mock( 'src/lib/get-ipc-api', () => ( {
	__esModule: true,
	default: jest.fn(),
	getIpcApi: () => ( {
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
		render( <AddSite /> );

		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
		await userEvent.tab();
		await userEvent.keyboard( '{Enter}' );

		expect( mockCreateSite ).not.toHaveBeenCalled();
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
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
		render( <AddSite /> );

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
				expect.any( String ),
				undefined,
				false,
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
		render( <AddSite /> );

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
		render( <AddSite /> );

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
		render( <AddSite /> );

		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
		await user.click( screen.getByDisplayValue( 'My WordPress Website' ) );
		await user.type( screen.getByDisplayValue( 'My WordPress Website' ), ' mutated' );

		expect( screen.getByDisplayValue( 'My WordPress Website mutated' ) ).toBeVisible();
		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );
		expect(
			screen.getByDisplayValue( '/default_path/my-wordpress-website-mutated' )
		).toBeVisible();

		await userEvent.keyboard( '{Escape}' );
		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );

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
		render( <AddSite /> );

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

		render( <AddSite /> );

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

		render( <AddSite /> );

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

		render( <AddSite /> );
		const user = userEvent.setup();

		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );

		const wpVersionSelect = screen.getByLabelText( 'WordPress version' );
		expect( wpVersionSelect ).toBeDisabled();
	} );

	it( 'should enable WordPress version field when online', async () => {
		( useOffline as jest.Mock ).mockReturnValue( false );

		render( <AddSite /> );
		const user = userEvent.setup();

		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );

		const wpVersionSelect = screen.getByLabelText( 'WordPress version' );
		expect( wpVersionSelect ).not.toBeDisabled();
	} );

	it( 'should show tooltip with offline message when hovering over disabled WordPress version field', async () => {
		( useOffline as jest.Mock ).mockReturnValue( true );

		render( <AddSite /> );
		const user = userEvent.setup();

		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );

		const wpVersionSelect = screen.getByLabelText( 'WordPress version' );
		await user.hover( wpVersionSelect );

		expect(
			screen.getByText( 'Changing WordPress version requires an internet connection.' )
		).toBeInTheDocument();
	} );

	it( 'should not show tooltip when hovering over WordPress version field while online', async () => {
		( useOffline as jest.Mock ).mockReturnValue( false );

		render( <AddSite /> );
		const user = userEvent.setup();

		await user.click( screen.getByRole( 'button', { name: 'Add site' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Advanced settings' } ) );

		const wpVersionSelect = screen.getByLabelText( 'WordPress version' );
		await user.hover( wpVersionSelect );

		expect(
			screen.queryByText( 'Changing WordPress version requires an internet connection.' )
		).not.toBeInTheDocument();
	} );
} );
