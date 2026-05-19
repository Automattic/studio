import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { vi } from 'vitest';
import { useRemoteSessionStatus } from 'src/hooks/use-remote-session-status';
import { RemoteSessionToggle } from 'src/modules/user-settings/components/remote-session-toggle';

vi.mock( 'src/hooks/use-remote-session-status' );

const mockStart = vi.fn();
const mockStop = vi.fn();

function setupHook( {
	isRunning,
	isLoading = false,
}: {
	isRunning: boolean;
	isLoading?: boolean;
} ) {
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

describe( 'RemoteSessionToggle', () => {
	it( 'renders unchecked when the daemon is not running', () => {
		setupHook( { isRunning: false } );

		render( <RemoteSessionToggle /> );

		expect( screen.getByLabelText( 'Remote session' ) ).not.toBeChecked();
	} );

	it( 'renders checked when the daemon is running', () => {
		setupHook( { isRunning: true } );

		render( <RemoteSessionToggle /> );

		expect( screen.getByLabelText( 'Remote session' ) ).toBeChecked();
	} );

	it( 'clicking the toggle when off invokes start()', async () => {
		const user = userEvent.setup();
		setupHook( { isRunning: false } );

		render( <RemoteSessionToggle /> );
		await user.click( screen.getByLabelText( 'Remote session' ) );

		expect( mockStart ).toHaveBeenCalledOnce();
		expect( mockStop ).not.toHaveBeenCalled();
	} );

	it( 'clicking the toggle when running invokes stop()', async () => {
		const user = userEvent.setup();
		setupHook( { isRunning: true } );

		render( <RemoteSessionToggle /> );
		await user.click( screen.getByLabelText( 'Remote session' ) );

		expect( mockStop ).toHaveBeenCalledOnce();
		expect( mockStart ).not.toHaveBeenCalled();
	} );

	it( 'is disabled while a transition is in flight', () => {
		setupHook( { isRunning: false, isLoading: true } );

		render( <RemoteSessionToggle /> );

		expect( screen.getByLabelText( 'Remote session' ) ).toBeDisabled();
	} );
} );
