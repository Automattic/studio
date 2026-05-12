import { act, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { vi } from 'vitest';
import { RemoteSessionIndicator } from 'src/components/remote-session-indicator';
import { useAuth } from 'src/hooks/use-auth';
import { useFeatureFlags } from 'src/hooks/use-feature-flags';
import { useRemoteSessionStatus } from 'src/hooks/use-remote-session-status';
import type { DaemonStatus } from 'cli/remote-session/daemon';

vi.mock( 'src/hooks/use-auth' );
vi.mock( 'src/hooks/use-feature-flags' );
vi.mock( 'src/hooks/use-remote-session-status' );

const mockStart = vi.fn();
const mockStop = vi.fn();

function setupHooks( {
	enableRemoteSessionUi,
	isAuthenticated,
	status,
	isLoading = false,
}: {
	enableRemoteSessionUi: boolean;
	isAuthenticated: boolean;
	status?: DaemonStatus;
	isLoading?: boolean;
} ) {
	vi.mocked( useFeatureFlags ).mockReturnValue( {
		enableBlueprints: true,
		enableStudioCodeUi: false,
		enableRemoteSessionUi,
	} );
	vi.mocked( useAuth, { partial: true } ).mockReturnValue( { isAuthenticated } );
	vi.mocked( useRemoteSessionStatus ).mockReturnValue( {
		status,
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
	it( 'renders nothing when the feature flag is off (AE2)', () => {
		setupHooks( { enableRemoteSessionUi: false, isAuthenticated: true } );

		const { container } = render( <RemoteSessionIndicator /> );

		expect( container ).toBeEmptyDOMElement();
	} );

	it( 'renders nothing when the user is logged out, even if the daemon is running (AE1)', () => {
		setupHooks( {
			enableRemoteSessionUi: true,
			isAuthenticated: false,
			status: { running: true, pid: 42, pidFile: '/tmp/pid' },
		} );

		const { container } = render( <RemoteSessionIndicator /> );

		expect( container ).toBeEmptyDOMElement();
	} );

	it( 'shows the "off" tooltip when the daemon is not running', () => {
		setupHooks( {
			enableRemoteSessionUi: true,
			isAuthenticated: true,
			status: { running: false, pidFile: '/tmp/pid' },
		} );

		render( <RemoteSessionIndicator /> );

		expect( screen.getByRole( 'switch', { name: 'Start remote session' } ) ).toBeVisible();
	} );

	it( 'shows the "active" tooltip when the daemon is running', () => {
		setupHooks( {
			enableRemoteSessionUi: true,
			isAuthenticated: true,
			status: { running: true, pid: 42, pidFile: '/tmp/pid' },
		} );

		render( <RemoteSessionIndicator /> );

		expect( screen.getByRole( 'switch', { name: 'Stop remote session' } ) ).toBeVisible();
	} );

	it( 'clicking when off invokes start() (AE3)', async () => {
		const user = userEvent.setup();
		setupHooks( {
			enableRemoteSessionUi: true,
			isAuthenticated: true,
			status: { running: false, pidFile: '/tmp/pid' },
		} );

		render( <RemoteSessionIndicator /> );

		await user.click( screen.getByRole( 'switch', { name: 'Start remote session' } ) );
		expect( mockStart ).toHaveBeenCalledOnce();
		expect( mockStop ).not.toHaveBeenCalled();
	} );

	it( 'clicking when running invokes stop()', async () => {
		const user = userEvent.setup();
		setupHooks( {
			enableRemoteSessionUi: true,
			isAuthenticated: true,
			status: { running: true, pid: 42, pidFile: '/tmp/pid' },
		} );

		render( <RemoteSessionIndicator /> );

		await user.click( screen.getByRole( 'switch', { name: 'Stop remote session' } ) );
		expect( mockStop ).toHaveBeenCalledOnce();
		expect( mockStart ).not.toHaveBeenCalled();
	} );

	it( 'leaves the indicator in the "off" visual state after a start attempt (AE7)', async () => {
		// AE7: when start fails, the indicator must stay in the off state. The
		// hook is responsible for catching the error and surfacing it via
		// showErrorMessageBox — see use-remote-session-status.test.tsx. By the
		// time the component's click handler awaits the hook's `start`, the
		// promise has resolved normally. The indicator never optimistically
		// flips its state; visual reconciliation comes from the next poll tick.
		const user = userEvent.setup();
		setupHooks( {
			enableRemoteSessionUi: true,
			isAuthenticated: true,
			status: { running: false, pidFile: '/tmp/pid' },
		} );

		render( <RemoteSessionIndicator /> );

		await user.click( screen.getByRole( 'switch', { name: 'Start remote session' } ) );

		await waitFor( () => expect( mockStart ).toHaveBeenCalledOnce() );
		expect( screen.getByRole( 'switch', { name: 'Start remote session' } ) ).toBeVisible();
	} );

	it( 'is disabled while a start/stop call is in flight (debounce)', async () => {
		const user = userEvent.setup();
		setupHooks( {
			enableRemoteSessionUi: true,
			isAuthenticated: true,
			status: { running: false, pidFile: '/tmp/pid' },
			isLoading: true,
		} );

		render( <RemoteSessionIndicator /> );

		const button = screen.getByRole( 'switch', { name: 'Start remote session' } );
		expect( button ).toBeDisabled();

		await act( async () => {
			await user.click( button );
		} );
		expect( mockStart ).not.toHaveBeenCalled();
	} );
} );
