// Run tests: yarn test -- src/components/onboarding.test.tsx
import { jest } from '@jest/globals';
import { render, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import Onboarding from 'src/components/onboarding';
import { useAddSite } from 'src/hooks/use-add-site';
import { useOnboarding } from 'src/hooks/use-onboarding';
import { FolderDialogResponse } from 'src/ipc-handlers';

jest.mock( 'src/hooks/use-onboarding', () => ( {
	useOnboarding: jest.fn(),
} ) );

jest.mock( 'src/hooks/use-add-site', () => ( {
	useAddSite: jest.fn(),
} ) );

jest.mock( 'src/lib/app-globals', () => ( {
	isMac: () => true,
} ) );

const mockGenerateProposedSitePath =
	jest.fn< ( siteName: string ) => Promise< FolderDialogResponse > >();

jest.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		generateProposedSitePath: mockGenerateProposedSitePath.mockResolvedValue( {
			path: '/default_path/My Site',
			name: 'My Site',
			isEmpty: true,
			isWordPress: false,
		} ),
		promptWindowsSpeedUpSites: jest.fn(),
	} ),
} ) );

describe( 'Onboarding Component', () => {
	beforeEach( () => {
		( useOnboarding as jest.Mock ).mockReturnValue( {
			needsOnboarding: true,
		} );
		( useAddSite as jest.Mock ).mockReturnValue( {
			setSiteName: jest.fn(),
			setProposedSitePath: jest.fn(),
			setSitePath: jest.fn(),
			setError: jest.fn(),
			setDoesPathContainWordPress: jest.fn(),
			siteName: 'My Site', // Adjust as needed
			sitePath: '/path/to/my/site', // Adjust as needed
			error: '', // Adjust as needed or based on test scenarios
			doesPathContainWordPress: false, // Adjust as needed
			handleAddSiteClick: jest.fn(),
			handleSiteNameChange: jest.fn(),
			handlePathSelectorClick: jest.fn(),
		} );
	} );

	it( 'renders onboarding screen correctly', () => {
		const { getByText } = render( <Onboarding /> );
		expect( getByText( 'Add your first site' ) ).toBeVisible();
		expect( getByText( 'Add site' ) ).toBeVisible();
	} );

	it( 'completes onboarding when the final button is clicked', async () => {
		const user = userEvent.setup();
		const { handleAddSiteClick } = useAddSite();

		const { getByText } = render( <Onboarding /> );

		await user.click( getByText( 'Add site' ) );

		// Check if handleAddSiteClick has been called and the process to create a new site started
		await waitFor( () => expect( handleAddSiteClick ).toHaveBeenCalled() );
	} );
} );
