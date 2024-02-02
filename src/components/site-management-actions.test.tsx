import { fireEvent, render } from '@testing-library/react';
import { SiteManagementActionProps, SiteManagementActions } from './site-management-actions';

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
		const { getByText } = render(
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
		expect( getByText( 'Running' ) ).not.toBeNull();
	} );
	it( 'should change text to Stop when hovered over a running site', () => {
		const { getByText } = render(
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
		fireEvent.mouseEnter( getByText( 'Running' ) );
		expect( getByText( 'Stop' ) ).toBeInTheDocument();
	} );
	it( 'should render "Start" button when site is not running', () => {
		const { getByText } = render(
			<SiteManagementActions
				{ ...defaultProps }
				selectedSite={ { running: false, id: 'site-1' } as SiteDetails }
			/>
		);
		expect( getByText( 'Start' ) ).toBeInTheDocument();
	} );
} );
