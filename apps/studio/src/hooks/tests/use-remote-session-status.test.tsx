// Run tests: npm test -- src/hooks/tests/use-remote-session-status.test.tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { vi } from 'vitest';
import { useRemoteSessionStatus } from 'src/hooks/use-remote-session-status';
import { createTestStore } from 'src/lib/test-utils';
import { applyIncomingStatus, loadRemoteSessionStatus } from 'src/stores/remote-session-slice';
import type { ReactNode } from 'react';

const mockGetStatus = vi.fn();
const mockStart = vi.fn();
const mockStop = vi.fn();
const mockShowErrorMessageBox = vi.fn();

vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		getRemoteSessionDaemonStatus: mockGetStatus,
		startRemoteSessionDaemon: mockStart,
		stopRemoteSessionDaemon: mockStop,
		showErrorMessageBox: mockShowErrorMessageBox,
	} ),
} ) );

function setup() {
	const store = createTestStore();
	const wrapper = ( { children }: { children: ReactNode } ) => (
		<Provider store={ store }>{ children }</Provider>
	);
	return { store, wrapper };
}

beforeEach( () => {
	mockGetStatus.mockReset();
	mockStart.mockReset();
	mockStop.mockReset();
	mockShowErrorMessageBox.mockReset();
} );

describe( 'useRemoteSessionStatus', () => {
	it( 'starts with status undefined, then reflects the initial IPC fetch', async () => {
		mockGetStatus.mockResolvedValue( { running: false } );

		const { store, wrapper } = setup();
		const { result } = renderHook( () => useRemoteSessionStatus(), { wrapper } );

		expect( result.current.status ).toBeUndefined();

		await act( async () => {
			await store.dispatch( loadRemoteSessionStatus() );
		} );

		expect( result.current.status ).toEqual( { running: false } );
	} );

	it( 'updates status when an incoming remote-session-status payload is dispatched', () => {
		const { store, wrapper } = setup();
		const { result } = renderHook( () => useRemoteSessionStatus(), { wrapper } );

		act( () => {
			store.dispatch( applyIncomingStatus( { running: true } ) );
		} );

		expect( result.current.status ).toEqual( { running: true } );
		expect( result.current.isRunning ).toBe( true );
	} );

	it( 'start() invokes startRemoteSessionDaemon and toggles isLoading', async () => {
		mockGetStatus.mockResolvedValue( { running: true } );
		mockStart.mockResolvedValue( { pid: 99, pidFile: '/tmp/pid' } );

		const { wrapper } = setup();
		const { result } = renderHook( () => useRemoteSessionStatus(), { wrapper } );

		await act( async () => {
			await result.current.start();
		} );

		expect( mockStart ).toHaveBeenCalledOnce();
		expect( result.current.isLoading ).toBe( false );
	} );

	it( 'surfaces start failures via showErrorMessageBox and reconciles isRunning back to false', async () => {
		mockGetStatus.mockResolvedValue( { running: false } );
		mockStart.mockRejectedValue( new Error( 'spawn timed out' ) );

		const { wrapper } = setup();
		const { result } = renderHook( () => useRemoteSessionStatus(), { wrapper } );

		await act( async () => {
			await result.current.start();
		} );

		expect( mockShowErrorMessageBox ).toHaveBeenCalledWith(
			expect.objectContaining( { message: 'spawn timed out' } )
		);
		// The thunk always re-fetches after the IPC call, so the cache catches
		// up to the real "still off" state.
		expect( result.current.status?.running ).toBe( false );
		expect( result.current.isRunning ).toBe( false );
	} );

	it( 'flips isRunning optimistically the moment start() is invoked', async () => {
		let resolveStart: ( value: { pid: number; pidFile: string } ) => void = () => undefined;
		mockStart.mockImplementation(
			() =>
				new Promise( ( resolve ) => {
					resolveStart = resolve;
				} )
		);
		mockGetStatus.mockResolvedValue( { running: true } );

		const { wrapper } = setup();
		const { result } = renderHook( () => useRemoteSessionStatus(), { wrapper } );

		expect( result.current.isRunning ).toBe( false );

		act( () => {
			void result.current.start();
		} );

		// Optimistic flip happens before the IPC resolves.
		expect( result.current.isRunning ).toBe( true );

		await act( async () => {
			resolveStart( { pid: 1, pidFile: '/tmp/pid' } );
		} );

		await waitFor( () => expect( result.current.isLoading ).toBe( false ) );
		expect( result.current.isRunning ).toBe( true );
	} );

	it( 'flips isRunning optimistically the moment stop() is invoked', async () => {
		let resolveStop: ( value: { stopped: true } ) => void = () => undefined;
		mockStop.mockImplementation(
			() =>
				new Promise( ( resolve ) => {
					resolveStop = resolve;
				} )
		);
		mockGetStatus.mockResolvedValue( { running: false } );

		const { store, wrapper } = setup();
		const { result } = renderHook( () => useRemoteSessionStatus(), { wrapper } );

		// Seed running=true via an incoming status event.
		act( () => {
			store.dispatch( applyIncomingStatus( { running: true } ) );
		} );
		expect( result.current.isRunning ).toBe( true );

		act( () => {
			void result.current.stop();
		} );

		expect( result.current.isRunning ).toBe( false );

		await act( async () => {
			resolveStop( { stopped: true } );
		} );

		await waitFor( () => expect( result.current.isLoading ).toBe( false ) );
		expect( result.current.isRunning ).toBe( false );
	} );

	it( 'stop() invokes stopRemoteSessionDaemon and surfaces failures via showErrorMessageBox', async () => {
		mockStop.mockRejectedValue( new Error( 'process refused to die' ) );
		mockGetStatus.mockResolvedValue( { running: true } );

		const { store, wrapper } = setup();
		const { result } = renderHook( () => useRemoteSessionStatus(), { wrapper } );

		act( () => {
			store.dispatch( applyIncomingStatus( { running: true } ) );
		} );

		await act( async () => {
			await result.current.stop();
		} );

		expect( mockStop ).toHaveBeenCalledOnce();
		expect( mockShowErrorMessageBox ).toHaveBeenCalledWith(
			expect.objectContaining( { message: 'process refused to die' } )
		);
	} );

	it( 'debounces concurrent start calls via the in-flight condition', async () => {
		mockGetStatus.mockResolvedValue( { running: false } );
		let resolveStart: ( value: { pid: number; pidFile: string } ) => void = () => undefined;
		mockStart.mockImplementation(
			() =>
				new Promise( ( resolve ) => {
					resolveStart = resolve;
				} )
		);

		const { wrapper } = setup();
		const { result } = renderHook( () => useRemoteSessionStatus(), { wrapper } );

		// Two starts in quick succession. The second's `condition` callback
		// sees `inFlight === true` and rejects the thunk synchronously, so the
		// underlying IPC handler is invoked only once.
		await act( async () => {
			void result.current.start();
			void result.current.start();
		} );

		await waitFor( () => expect( result.current.isLoading ).toBe( true ) );
		expect( mockStart ).toHaveBeenCalledOnce();

		await act( async () => {
			resolveStart( { pid: 1, pidFile: '/tmp/pid' } );
		} );
		await waitFor( () => expect( result.current.isLoading ).toBe( false ) );
	} );

	it( 'shares state across hook instances so an optimistic flip in one reaches the other', async () => {
		mockGetStatus.mockResolvedValue( { running: false } );
		let resolveStart: ( value: { pid: number; pidFile: string } ) => void = () => undefined;
		mockStart.mockImplementation(
			() =>
				new Promise( ( resolve ) => {
					resolveStart = resolve;
				} )
		);

		const { wrapper } = setup();
		const { result: toggle } = renderHook( () => useRemoteSessionStatus(), { wrapper } );
		const { result: indicator } = renderHook( () => useRemoteSessionStatus(), { wrapper } );

		expect( toggle.current.isRunning ).toBe( false );
		expect( indicator.current.isRunning ).toBe( false );

		act( () => {
			void toggle.current.start();
		} );

		expect( toggle.current.isRunning ).toBe( true );
		expect( indicator.current.isRunning ).toBe( true );

		mockGetStatus.mockResolvedValueOnce( { running: true } );
		await act( async () => {
			resolveStart( { pid: 1, pidFile: '/tmp/pid' } );
		} );
		await waitFor( () => expect( toggle.current.isLoading ).toBe( false ) );

		expect( indicator.current.isRunning ).toBe( true );
	} );
} );
