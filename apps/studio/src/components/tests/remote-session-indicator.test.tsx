import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { vi } from 'vitest';
import { RemoteSessionIndicator } from 'src/components/remote-session-indicator';
import { useAuth } from 'src/hooks/use-auth';
import { useBetaFeatures } from 'src/hooks/use-beta-features';
import { useRemoteSessionStatus } from 'src/hooks/use-remote-session-status';

const mockStart = vi.fn();
const mockStop = vi.fn();

vi.mock( 'src/hooks/use-auth', () => ( {
	useAuth: vi.fn(),
} ) );

vi.mock( 'src/hooks/use-beta-features', () => ( {
	useBetaFeatures: vi.fn(),
} ) );

vi.mock( 'src/hooks/use-remote-session-status', () => ( {
	useRemoteSessionStatus: vi.fn(),
} ) );

function setupHooks( {
	remoteSession,
	isAuthenticated,
	isRunning,
	isLoading = false,
}: {
	remoteSession: boolean;
	isAuthenticated: boolean;
	isRunning: boolean;
	isLoading?: boolean;
} ) {
	vi.mocked( useBetaFeatures ).mockReturnValue( { remoteSession } );
	vi.mocked( useAuth, { partial: true } ).mockReturnValue( { isAuthenticated } );
	vi.mocked( useRemoteSessionStatus ).mockReturnValue( {
		status: isRunning ? { running: true } : undefined,
		isRunning,
		isLoading,
		start: mockStart,
		stop: mockStop,
	} );
}

beforeEach( () => {
	mockStart.mockReset().mockResolvedValue( undefined );
	mockStop.mockReset().mockResolvedValue( undefined );
} );

describe( 'RemoteSessionIndicator', () => {
	it( 'renders nothing when the beta feature is off', () => {
		setupHooks( { remoteSession: false, isAuthenticated: true, isRunning: false } );

		const { container } = render( <RemoteSessionIndicator /> );

		expect( container ).toBeEmptyDOMElement();
	} );

	it( 'renders nothing when the user is logged out', () => {
		setupHooks( { remoteSession: true, isAuthenticated: false, isRunning: true } );

		const { container } = render( <RemoteSessionIndicator /> );

		expect( container ).toBeEmptyDOMElement();
	} );

	it( 'shows the off state with a "Start remote session" tooltip when the daemon is paused', () => {
		setupHooks( { remoteSession: true, isAuthenticated: true, isRunning: false } );

		render( <RemoteSessionIndicator /> );

		const button = screen.getByRole( 'button', { name: 'Start remote session' } );
		expect( button ).toBeVisible();
		expect( button ).not.toHaveAttribute( 'aria-pressed' );
		const icon = button.querySelector( 'svg' );
		expect( icon?.getAttribute( 'class' ) ).toContain( 'text-white' );
		expect( icon?.getAttribute( 'class' ) ).not.toContain( 'frame-running' );
	} );

	it( 'shows the on state with a "Stop remote session" tooltip when the daemon is running', () => {
		setupHooks( { remoteSession: true, isAuthenticated: true, isRunning: true } );

		render( <RemoteSessionIndicator /> );

		const button = screen.getByRole( 'button', { name: 'Stop remote session' } );
		expect( button ).toBeVisible();
		expect( button ).not.toHaveAttribute( 'aria-pressed' );
		const icon = button.querySelector( 'svg' );
		expect( icon?.getAttribute( 'class' ) ).toContain( '!text-frame-running' );
	} );

	it( 'clicking when off invokes start()', async () => {
		const user = userEvent.setup();
		setupHooks( { remoteSession: true, isAuthenticated: true, isRunning: false } );

		render( <RemoteSessionIndicator /> );

		await user.click( screen.getByRole( 'button', { name: 'Start remote session' } ) );

		expect( mockStart ).toHaveBeenCalledOnce();
		expect( mockStop ).not.toHaveBeenCalled();
	} );

	it( 'clicking when running invokes stop()', async () => {
		const user = userEvent.setup();
		setupHooks( { remoteSession: true, isAuthenticated: true, isRunning: true } );

		render( <RemoteSessionIndicator /> );

		await user.click( screen.getByRole( 'button', { name: 'Stop remote session' } ) );

		expect( mockStop ).toHaveBeenCalledOnce();
		expect( mockStart ).not.toHaveBeenCalled();
	} );

	it( 'pulses while a transition is in flight and stops once isLoading clears', () => {
		setupHooks( {
			remoteSession: true,
			isAuthenticated: true,
			isRunning: false,
			isLoading: true,
		} );
		const { rerender } = render( <RemoteSessionIndicator /> );

		// Mid-transition: the hook has flipped optimistic running and isLoading is on.
		setupHooks( {
			remoteSession: true,
			isAuthenticated: true,
			isRunning: true,
			isLoading: true,
		} );
		rerender( <RemoteSessionIndicator /> );

		const icon = screen
			.getByRole( 'button', { name: 'Stop remote session' } )
			.querySelector( 'svg' );
		expect( icon?.getAttribute( 'class' ) ).toContain( 'animate-pulse' );

		// Status confirmed: isLoading drops, pulse goes away on the next render.
		setupHooks( {
			remoteSession: true,
			isAuthenticated: true,
			isRunning: true,
			isLoading: false,
		} );
		rerender( <RemoteSessionIndicator /> );

		const settled = screen
			.getByRole( 'button', { name: 'Stop remote session' } )
			.querySelector( 'svg' );
		expect( settled?.getAttribute( 'class' ) ).not.toContain( 'animate-pulse' );
	} );

	it( 'is debounced via the in-flight gate when isLoading is true', async () => {
		const user = userEvent.setup();
		setupHooks( {
			remoteSession: true,
			isAuthenticated: true,
			isRunning: false,
			isLoading: true,
		} );

		render( <RemoteSessionIndicator /> );

		await user.click( screen.getByRole( 'button', { name: 'Start remote session' } ) );
		expect( mockStart ).not.toHaveBeenCalled();
	} );
} );
