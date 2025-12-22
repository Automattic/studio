import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Provider } from 'react-redux';
import {
	SiteManagementActionProps,
	SiteManagementActions,
} from 'src/components/site-management-actions';
import { ContentTabsProvider } from 'src/hooks/use-content-tabs';
import { store } from 'src/stores';
import { connectedSitesApi } from 'src/stores/sync/connected-sites';

const mockGetConnectedWpcomSites = jest.fn();
const mockUpdateSingleConnectedWpcomSite = jest.fn();

jest.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: jest.fn( () => ( {
		getConnectedWpcomSites: mockGetConnectedWpcomSites,
		updateSingleConnectedWpcomSite: mockUpdateSingleConnectedWpcomSite,
	} ) ),
} ) );

// Mock useSiteDetails to return the site passed via context
jest.mock( 'src/hooks/use-site-details', () => ( {
	useSiteDetails: () => ( {
		selectedSite: { id: 'site-1', running: false },
	} ),
} ) );

// Mock useAuth to return a dummy user
jest.mock( 'src/hooks/use-auth', () => ( {
	useAuth: () => ( {
		user: { id: 1 },
		isAuthenticated: true,
	} ),
} ) );

const defaultProps = {
	onStart: jest.fn(),
	onStop: jest.fn(),
	loading: false,
} as SiteManagementActionProps;
describe( 'SiteManagementActions', () => {
	beforeEach( () => {
		// Reset mock calls but preserve implementations
		mockGetConnectedWpcomSites.mockClear();
		mockUpdateSingleConnectedWpcomSite.mockClear();
		// Set default return values
		mockGetConnectedWpcomSites.mockResolvedValue( [] );
		mockUpdateSingleConnectedWpcomSite.mockResolvedValue( {} );
		// Clear RTK Query cache between tests
		store.dispatch( connectedSitesApi.util.resetApiState() );
	} );
	const renderWithProvider = ( children: React.ReactElement ) => {
		return render(
			<Provider store={ store }>
				<ContentTabsProvider>{ children }</ContentTabsProvider>
			</Provider>
		);
	};
	it( 'should not render when selectedSite is undefined', () => {
		const { container } = renderWithProvider(
			<SiteManagementActions { ...defaultProps } selectedSite={ undefined } />
		);
		expect( container ).toBeEmptyDOMElement();
	} );
	it( 'should render correctly with a running site', () => {
		renderWithProvider(
			<SiteManagementActions
				{ ...defaultProps }
				selectedSite={
					{
						running: true,
						id: 'site-1',
					} as SiteDetails
				}
			/>
		);
		expect( screen.getByRole( 'button', { name: 'Running' } ) ).toBeInTheDocument();
	} );
	it( 'should change text to Stop when hovered over a running site', async () => {
		const user = userEvent.setup();
		renderWithProvider(
			<SiteManagementActions
				{ ...defaultProps }
				selectedSite={
					{
						running: true,
						id: 'site-1',
					} as SiteDetails
				}
			/>
		);
		const startStopButton = screen.getByRole( 'button', { name: 'Running' } );
		await user.hover( startStopButton );
		expect( startStopButton ).toHaveTextContent( 'Stop' );
	} );
	it( 'should render "Start" button when site is not running', () => {
		renderWithProvider(
			<SiteManagementActions
				{ ...defaultProps }
				selectedSite={ { running: false, id: 'site-1' } as SiteDetails }
			/>
		);
		expect( screen.getByRole( 'button', { name: 'Start' } ) ).toBeVisible();
	} );

	describe( 'PublishSiteButton', () => {
		it( 'should render "Publish site" button when no sites are connected', async () => {
			renderWithProvider(
				<SiteManagementActions
					{ ...defaultProps }
					selectedSite={ { running: false, id: 'site-1' } as SiteDetails }
				/>
			);
			// Wait for the async query to resolve
			const publishButton = await screen.findByRole( 'button', { name: 'Publish site' } );
			expect( publishButton ).toBeInTheDocument();
			expect( publishButton ).toBeVisible();
		} );

		it( 'should not render "Publish site" button when one site is connected', async () => {
			// Set up mock to return connected sites and clear the cache
			mockGetConnectedWpcomSites.mockResolvedValue( [
				{
					id: 1,
					localSiteId: 'site-1',
					url: 'https://example.wordpress.com',
					name: 'Example Site',
				},
			] );
			// Clear the cache again after changing the mock
			store.dispatch( connectedSitesApi.util.resetApiState() );

			renderWithProvider(
				<SiteManagementActions
					{ ...defaultProps }
					selectedSite={ { running: false, id: 'site-1' } as SiteDetails }
				/>
			);

			// First wait for the Start button to ensure component is fully rendered
			await screen.findByRole( 'button', { name: 'Start' } );

			// Then wait for Publish site button to disappear - it may appear briefly before query resolves
			await waitFor(
				() => {
					const publishButton = screen.queryByRole( 'button', { name: 'Publish site' } );
					expect( publishButton ).not.toBeInTheDocument();
				},
				{ timeout: 1000 }
			);
		} );

		it( 'should not render "Publish site" button when multiple sites are connected', async () => {
			// Set up mock to return multiple connected sites and clear the cache
			mockGetConnectedWpcomSites.mockResolvedValue( [
				{
					id: 1,
					localSiteId: 'site-1',
					url: 'https://example1.wordpress.com',
					name: 'Example Site 1',
				},
				{
					id: 2,
					localSiteId: 'site-1',
					url: 'https://example2.wordpress.com',
					name: 'Example Site 2',
				},
			] );
			// Clear the cache again after changing the mock
			store.dispatch( connectedSitesApi.util.resetApiState() );

			renderWithProvider(
				<SiteManagementActions
					{ ...defaultProps }
					selectedSite={ { running: false, id: 'site-1' } as SiteDetails }
				/>
			);

			// First wait for the Start button to ensure component is fully rendered
			await screen.findByRole( 'button', { name: 'Start' } );

			// Then wait for Publish site button to disappear - it may appear briefly before query resolves
			await waitFor(
				() => {
					const publishButton = screen.queryByRole( 'button', { name: 'Publish site' } );
					expect( publishButton ).not.toBeInTheDocument();
				},
				{ timeout: 1000 }
			);
		} );

		it( 'should render "Publish site" button alongside "Running" button when no sites are connected', async () => {
			mockGetConnectedWpcomSites.mockResolvedValue( [] );
			renderWithProvider(
				<SiteManagementActions
					{ ...defaultProps }
					selectedSite={ { running: true, id: 'site-1' } as SiteDetails }
				/>
			);
			// Both buttons should be present
			const runningButton = screen.getByRole( 'button', { name: 'Running' } );
			const publishButton = await screen.findByRole( 'button', { name: 'Publish site' } );
			expect( runningButton ).toBeVisible();
			expect( publishButton ).toBeVisible();
		} );
	} );
} );
