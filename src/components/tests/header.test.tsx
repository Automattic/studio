import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { SiteDetailsProvider } from '../../hooks/use-site-details';
import { getIpcApi } from '../../lib/get-ipc-api';
import Header from '../header';

jest.mock( '../../lib/get-ipc-api' );

const mockedGetIpcApi = getIpcApi as jest.Mock;
const mockedSites = [
	{
		name: 'test-1',
		path: '/fake/test-1',
		running: false,
		id: 'mock-id',
		port: 8881,
	},
];

function mockGetIpcApi( mocks: Record< string, jest.Mock > ) {
	mockedGetIpcApi.mockReturnValue( {
		getSiteDetails: jest.fn( () => Promise.resolve( mockedSites ) ),
		getSnapshots: jest.fn( () => Promise.resolve( [] ) ),
		saveSnapshotsToStorage: jest.fn( () => Promise.resolve() ),
		startServer: jest.fn( () => Promise.resolve( { running: true } ) ),
		showErrorMessageBox: jest.fn(),
		...mocks,
	} );
}

afterEach( () => {
	jest.clearAllMocks();
	jest.restoreAllMocks();
} );

describe( 'Header', () => {
	it( 'should start site servers', async () => {
		const user = userEvent.setup();
		mockGetIpcApi( {} );
		render(
			<SiteDetailsProvider>
				<Header />
			</SiteDetailsProvider>
		);

		await screen.findByText( 'test-1' );
		const startButton = screen.getByRole( 'button', { name: 'Start' } );
		await user.click( startButton );

		expect( mockedGetIpcApi().startServer ).toHaveBeenCalledTimes( 1 );
		expect( screen.getByText( 'Stop' ) ).toBeVisible();
	} );

	describe( 'when starting a server fails', () => {
		it( 'should display an error message', async () => {
			const user = userEvent.setup();
			const error = new Error( 'Failed to start the server' );
			mockGetIpcApi( {
				startServer: jest.fn( () => {
					throw error;
				} ),
				stopServer: jest.fn( () => Promise.resolve( { running: false } ) ),
			} );
			render(
				<SiteDetailsProvider>
					<Header />
				</SiteDetailsProvider>
			);

			await screen.findByText( 'test-1' );
			const startButton = screen.getByRole( 'button', { name: 'Start' } );
			await user.click( startButton );

			expect( mockedGetIpcApi().startServer ).toHaveBeenCalledTimes( 1 );
			expect( screen.getByText( 'Start' ) ).toBeVisible();
			expect( mockedGetIpcApi().showErrorMessageBox ).toHaveBeenCalledTimes( 1 );
			expect( mockedGetIpcApi().showErrorMessageBox ).toHaveBeenCalledWith( {
				title: 'Failed to start the site server',
				message:
					"Please verify your site's local path directory contains the standard WordPress installation files and try again. If this problem persists, please contact support.",
				error,
			} );
		} );
	} );
} );
