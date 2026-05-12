// Run tests: npm test -- src/hooks/tests/use-remote-session-status.test.tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { useRemoteSessionStatus } from 'src/hooks/use-remote-session-status';
import type { DaemonStatus } from 'cli/remote-session/daemon';
import type { IpcRendererEvent } from 'electron';

type IpcListener = ( event: IpcRendererEvent, status: DaemonStatus ) => void;

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

let registeredListener: IpcListener | undefined;

beforeEach( () => {
	registeredListener = undefined;
	mockGetStatus.mockReset();
	mockStart.mockReset();
	mockStop.mockReset();
	mockShowErrorMessageBox.mockReset();

	window.ipcListener = {
		subscribe: vi.fn( ( channel, listener ) => {
			if ( channel === 'remote-session-status' ) {
				registeredListener = listener as IpcListener;
			}
			return () => {
				if ( channel === 'remote-session-status' ) {
					registeredListener = undefined;
				}
			};
		} ),
	};
} );

describe( 'useRemoteSessionStatus', () => {
	it( 'starts with status undefined, then reflects the initial IPC fetch', async () => {
		mockGetStatus.mockResolvedValue( { running: false, pidFile: '/tmp/pid' } );

		const { result } = renderHook( () => useRemoteSessionStatus() );

		expect( result.current.status ).toBeUndefined();
		await waitFor( () => {
			expect( result.current.status ).toEqual( { running: false, pidFile: '/tmp/pid' } );
		} );
	} );

	it( 'updates status when a remote-session-status event arrives', async () => {
		mockGetStatus.mockResolvedValue( { running: false, pidFile: '/tmp/pid' } );

		const { result } = renderHook( () => useRemoteSessionStatus() );
		await waitFor( () => {
			expect( result.current.status?.running ).toBe( false );
		} );

		act( () => {
			registeredListener?.( {} as IpcRendererEvent, {
				running: true,
				pid: 42,
				pidFile: '/tmp/pid',
			} );
		} );

		expect( result.current.status ).toEqual( { running: true, pid: 42, pidFile: '/tmp/pid' } );
	} );

	it( 'start() invokes startRemoteSessionDaemon and toggles isLoading', async () => {
		mockGetStatus.mockResolvedValue( { running: false, pidFile: '/tmp/pid' } );
		mockStart.mockResolvedValue( { pid: 99, pidFile: '/tmp/pid' } );

		const { result } = renderHook( () => useRemoteSessionStatus() );
		await waitFor( () => expect( result.current.status ).toBeDefined() );

		await act( async () => {
			await result.current.start();
		} );

		expect( mockStart ).toHaveBeenCalledOnce();
		expect( result.current.isLoading ).toBe( false );
	} );

	it( 'surfaces start failures via showErrorMessageBox and leaves status unchanged (AE7)', async () => {
		mockGetStatus.mockResolvedValue( { running: false, pidFile: '/tmp/pid' } );
		mockStart.mockRejectedValue( new Error( 'spawn timed out' ) );

		const { result } = renderHook( () => useRemoteSessionStatus() );
		await waitFor( () => expect( result.current.status ).toBeDefined() );

		await act( async () => {
			await result.current.start();
		} );

		expect( mockShowErrorMessageBox ).toHaveBeenCalledWith(
			expect.objectContaining( { message: 'spawn timed out' } )
		);
		// Status was not flipped optimistically — the next poll tick is the source of truth.
		expect( result.current.status?.running ).toBe( false );
	} );

	it( 'stop() invokes stopRemoteSessionDaemon and surfaces failures via showErrorMessageBox', async () => {
		mockGetStatus.mockResolvedValue( { running: true, pid: 7, pidFile: '/tmp/pid' } );
		mockStop.mockRejectedValue( new Error( 'process refused to die' ) );

		const { result } = renderHook( () => useRemoteSessionStatus() );
		await waitFor( () => expect( result.current.status?.running ).toBe( true ) );

		await act( async () => {
			await result.current.stop();
		} );

		expect( mockStop ).toHaveBeenCalledOnce();
		expect( mockShowErrorMessageBox ).toHaveBeenCalledWith(
			expect.objectContaining( { message: 'process refused to die' } )
		);
	} );

	it( 'debounces concurrent start calls via isLoading', async () => {
		mockGetStatus.mockResolvedValue( { running: false, pidFile: '/tmp/pid' } );
		let resolveStart: ( value: { pid: number; pidFile: string } ) => void = () => undefined;
		mockStart.mockImplementation(
			() =>
				new Promise( ( resolve ) => {
					resolveStart = resolve;
				} )
		);

		const { result } = renderHook( () => useRemoteSessionStatus() );
		await waitFor( () => expect( result.current.status ).toBeDefined() );

		// Fire two start calls in quick succession. The second should be ignored
		// because isLoading is true.
		act( () => {
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
} );
