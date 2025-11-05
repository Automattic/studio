import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Provider } from 'react-redux';
import {
	SiteManagementActionProps,
	SiteManagementActions,
} from 'src/components/site-management-actions';
import { SyncSitesProvider } from 'src/hooks/sync-sites';
import { ContentTabsProvider } from 'src/hooks/use-content-tabs';
import { store } from 'src/stores';

jest.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		getConnectedWpcomSites: jest.fn().mockResolvedValue( [] ),
		updateSingleConnectedWpcomSite: jest.fn().mockResolvedValue( {} ),
	} ),
} ) );

const defaultProps = {
	onStart: jest.fn(),
	onStop: jest.fn(),
	loading: false,
} as SiteManagementActionProps;
describe( 'SiteManagementActions', () => {
	beforeEach( () => {
		jest.clearAllMocks();
	} );
	const renderWithProvider = ( children: React.ReactElement ) => {
		return render(
			<Provider store={ store }>
				<ContentTabsProvider>
					<SyncSitesProvider>{ children }</SyncSitesProvider>
				</ContentTabsProvider>
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
} );
