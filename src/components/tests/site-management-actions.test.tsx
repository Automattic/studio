import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { SyncSitesProvider } from '../../hooks/sync-sites';
import { ContentTabsProvider } from '../../hooks/use-content-tabs';
import { SiteManagementActionProps, SiteManagementActions } from '../site-management-actions';

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
			<ContentTabsProvider>
				<SyncSitesProvider>{ children }</SyncSitesProvider>
			</ContentTabsProvider>
		);
	};
	it( 'should not render when selectedSite is undefined', () => {
		const { container } = renderWithProvider(
			<SiteManagementActions { ...defaultProps } selectedSite={ undefined } />
		);
		expect( container.firstChild ).toBeNull();
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
		expect( screen.getByRole( 'button', { name: 'Running' } ) ).not.toBeNull();
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
