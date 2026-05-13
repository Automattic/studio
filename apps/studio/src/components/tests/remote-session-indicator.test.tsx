import { act, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { vi } from 'vitest';
import { RemoteSessionIndicator } from 'src/components/remote-session-indicator';
import { useAuth } from 'src/hooks/use-auth';
import { useBetaFeatures } from 'src/hooks/use-beta-features';
import { useRemoteSessionStatus } from 'src/hooks/use-remote-session-status';
import { getIpcApi } from 'src/lib/get-ipc-api';

vi.mock( 'src/hooks/use-auth' );
vi.mock( 'src/hooks/use-beta-features' );
vi.mock( 'src/hooks/use-remote-session-status' );
vi.mock( 'src/lib/get-ipc-api' );

function setupHooks( {
	remoteSession,
	isAuthenticated,
	isRunning,
}: {
	remoteSession: boolean;
	isAuthenticated: boolean;
	isRunning: boolean;
} ) {
	vi.mocked( useBetaFeatures ).mockReturnValue( { remoteSession } );
	vi.mocked( useAuth, { partial: true } ).mockReturnValue( { isAuthenticated } );
	vi.mocked( useRemoteSessionStatus ).mockReturnValue( {
		status: isRunning ? { running: true, pid: 42, pidFile: '/tmp/pid' } : undefined,
		isRunning,
		isLoading: false,
		start: vi.fn(),
		stop: vi.fn(),
	} );
}

const mockShowUserSettings = vi.fn();

beforeEach( () => {
	mockShowUserSettings.mockReset();
	vi.mocked( getIpcApi ).mockReturnValue( {
		showUserSettings: mockShowUserSettings,
	} as unknown as ReturnType< typeof getIpcApi > );
} );

describe( 'RemoteSessionIndicator', () => {
	it( 'renders nothing when the beta feature is off', () => {
		setupHooks( { remoteSession: false, isAuthenticated: true, isRunning: true } );

		const { container } = render( <RemoteSessionIndicator /> );

		expect( container ).toBeEmptyDOMElement();
	} );

	it( 'renders nothing when the user is logged out, even if the daemon is running', () => {
		setupHooks( { remoteSession: true, isAuthenticated: false, isRunning: true } );

		const { container } = render( <RemoteSessionIndicator /> );

		expect( container ).toBeEmptyDOMElement();
	} );

	it( 'renders nothing when the daemon is not running', () => {
		setupHooks( { remoteSession: true, isAuthenticated: true, isRunning: false } );

		const { container } = render( <RemoteSessionIndicator /> );

		expect( container ).toBeEmptyDOMElement();
	} );

	it( 'renders a green circular button labelled "Remote session active" when the daemon is running', () => {
		setupHooks( { remoteSession: true, isAuthenticated: true, isRunning: true } );

		render( <RemoteSessionIndicator /> );

		const button = screen.getByRole( 'button', { name: 'Remote session active' } );
		expect( button ).toBeVisible();
		// The visible circle is the inner span — sanity check that it carries the
		// green token and is sized like the other top-bar icons.
		const circle = button.querySelector( 'span' );
		expect( circle ).toHaveClass( 'bg-frame-running' );
		expect( circle ).toHaveClass( 'h-6', 'w-6', 'rounded-full' );
	} );

	it( 'clicking the indicator opens settings on the general tab scrolled to the toggle', async () => {
		const user = userEvent.setup();
		setupHooks( { remoteSession: true, isAuthenticated: true, isRunning: true } );

		render( <RemoteSessionIndicator /> );

		await user.click( screen.getByRole( 'button', { name: 'Remote session active' } ) );

		expect( mockShowUserSettings ).toHaveBeenCalledWith( 'general', 'remote-session' );
	} );

	it( 'pulses briefly on the off → on transition and settles to static', () => {
		vi.useFakeTimers();
		try {
			setupHooks( { remoteSession: true, isAuthenticated: true, isRunning: false } );
			const { rerender } = render( <RemoteSessionIndicator /> );

			setupHooks( { remoteSession: true, isAuthenticated: true, isRunning: true } );
			rerender( <RemoteSessionIndicator /> );

			const circle = screen
				.getByRole( 'button', { name: 'Remote session active' } )
				.querySelector( 'span' );
			expect( circle ).toHaveClass( 'animate-pulse' );

			act( () => {
				vi.advanceTimersByTime( 3000 );
			} );

			expect( circle ).not.toHaveClass( 'animate-pulse' );
		} finally {
			vi.useRealTimers();
		}
	} );
} );
