import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
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
	it( 'should not render when selectedSite is undefined', () => {
		const { container } = render(
			<SiteManagementActions { ...defaultProps } selectedSite={ undefined } />
		);
		expect( container.firstChild ).toBeNull();
	} );
	it( 'should render correctly with a running site', () => {
		render(
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
		render(
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
		const runningButton = screen.getByRole( 'button', { name: 'Running' } );
		const stopButton = screen.getByRole( 'button', { name: 'Stop' } );
		expect( runningButton ).toHaveClass( 'visible' );
		expect( stopButton ).toHaveClass( 'invisible' );
		await user.hover( runningButton );
		expect( runningButton ).toHaveClass( 'invisible' );
		expect( stopButton ).toHaveClass( 'visible' );
	} );
	it( 'should render "Start" button when site is not running', () => {
		render(
			<SiteManagementActions
				{ ...defaultProps }
				selectedSite={ { running: false, id: 'site-1' } as SiteDetails }
			/>
		);
		expect( screen.getByRole( 'button', { name: 'Start' } ) ).toBeInTheDocument();
	} );
} );
