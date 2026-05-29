// Run tests: npm test -- src/hooks/tests/use-remote-session-status.test.tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { useRemoteSessionStatus } from 'src/hooks/use-remote-session-status';
import type { RemoteSessionStatus } from '@studio/common/lib/remote-session';
import type { IpcRendererEvent } from 'electron';

const { mockGetStatus, mockStart, mockStop, mockShowErrorMessageBox, mockUseIpcListener } =
	vi.hoisted( () => ( {
		mockGetStatus: vi.fn(),
		mockStart: vi.fn(),
		mockStop: vi.fn(),
		mockShowErrorMessageBox: vi.fn(),
		mockUseIpcListener: vi.fn(),
	} ) );

vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		getRemoteSessionDaemonStatus: mockGetStatus,
		startRemoteSessionDaemon: mockStart,
		stopRemoteSessionDaemon: mockStop,
		showErrorMessageBox: mockShowErrorMessageBox,
	} ),
} ) );

vi.mock( 'src/hooks/use-ipc-listener', () => ( {
	useIpcListener: mockUseIpcListener,
} ) );

function emitRemoteSessionStatus( status: RemoteSessionStatus ) {
	const listener = mockUseIpcListener.mock.calls.at( -1 )?.[ 1 ];
	if ( ! listener ) {
		throw new Error( 'remote-session-status listener was not registered' );
	}

	act( () => {
		listener( {} as IpcRendererEvent, status );
	} );
}

beforeEach( () => {
	mockGetStatus.mockReset();
	mockStart.mockReset();
	mockStop.mockReset();
	mockShowErrorMessageBox.mockReset();
	mockUseIpcListener.mockReset();
} );

describe( 'useRemoteSessionStatus', () => {
	it( 'starts with status undefined, then reflects the initial IPC fetch', async () => {
		mockGetStatus.mockResolvedValue( { running: false } );

		const { result } = renderHook( () => useRemoteSessionStatus() );

		expect( result.current.status ).toBeUndefined();

		await waitFor( () => expect( result.current.status ).toEqual( { running: false } ) );
	} );

	it( 'updates status from incoming remote-session-status payloads', () => {
		mockGetStatus.mockImplementation( () => new Promise( () => undefined ) );

		const { result } = renderHook( () => useRemoteSessionStatus() );

		emitRemoteSessionStatus( { running: true } );

		expect( result.current.status ).toEqual( { running: true } );
		expect( result.current.isRunning ).toBe( true );
	} );

	it( 'keeps the remote-session-status listener stable across re-renders', () => {
		mockGetStatus.mockImplementation( () => new Promise( () => undefined ) );

		const { rerender } = renderHook( () => useRemoteSessionStatus() );
		const firstListener = mockUseIpcListener.mock.calls.at( -1 )?.[ 1 ];

		rerender();

		expect( mockUseIpcListener.mock.calls.at( -1 )?.[ 1 ] ).toBe( firstListener );
	} );

	it( 'start() invokes startRemoteSessionDaemon and toggles isLoading', async () => {
		mockGetStatus
			.mockResolvedValueOnce( { running: false } )
			.mockResolvedValue( { running: true } );
		mockStart.mockResolvedValue( { pid: 99, pidFile: '/tmp/pid' } );

		const { result } = renderHook( () => useRemoteSessionStatus() );
		await waitFor( () => expect( result.current.status ).toEqual( { running: false } ) );

		await act( async () => {
			await result.current.start();
		} );

		expect( mockStart ).toHaveBeenCalledOnce();
		expect( result.current.isLoading ).toBe( false );
		expect( result.current.isRunning ).toBe( true );
	} );

	it( 'surfaces start failures via showErrorMessageBox and reconciles isRunning back to false', async () => {
		mockGetStatus
			.mockResolvedValueOnce( { running: false } )
			.mockResolvedValue( { running: false } );
		mockStart.mockRejectedValue( new Error( 'spawn timed out' ) );

		const { result } = renderHook( () => useRemoteSessionStatus() );
		await waitFor( () => expect( result.current.status ).toEqual( { running: false } ) );

		await act( async () => {
			await result.current.start();
		} );

		expect( mockShowErrorMessageBox ).toHaveBeenCalledWith(
			expect.objectContaining( { message: 'spawn timed out' } )
		);
		expect( result.current.status?.running ).toBe( false );
		expect( result.current.isRunning ).toBe( false );
	} );

	it( 'flips isRunning optimistically the moment start() is invoked', async () => {
		let resolveStart: ( value: { pid: number; pidFile: string } ) => void = () => undefined;
		mockGetStatus
			.mockResolvedValueOnce( { running: false } )
			.mockResolvedValue( { running: true } );
		mockStart.mockImplementation(
			() =>
				new Promise( ( resolve ) => {
					resolveStart = resolve;
				} )
		);

		const { result } = renderHook( () => useRemoteSessionStatus() );
		await waitFor( () => expect( result.current.isRunning ).toBe( false ) );

		act( () => {
			void result.current.start();
		} );

		expect( result.current.isRunning ).toBe( true );

		await act( async () => {
			resolveStart( { pid: 1, pidFile: '/tmp/pid' } );
		} );

		await waitFor( () => expect( result.current.isLoading ).toBe( false ) );
		expect( result.current.isRunning ).toBe( true );
	} );

	it( 'flips isRunning optimistically the moment stop() is invoked', async () => {
		let resolveStop: ( value: { stopped: true } ) => void = () => undefined;
		mockGetStatus
			.mockResolvedValueOnce( { running: true } )
			.mockResolvedValue( { running: false } );
		mockStop.mockImplementation(
			() =>
				new Promise( ( resolve ) => {
					resolveStop = resolve;
				} )
		);

		const { result } = renderHook( () => useRemoteSessionStatus() );
		await waitFor( () => expect( result.current.isRunning ).toBe( true ) );

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

	it( 'ignores stale poll events that contradict an in-flight optimistic transition', async () => {
		let resolveStop: ( value: { stopped: true } ) => void = () => undefined;
		mockGetStatus
			.mockResolvedValueOnce( { running: true } )
			.mockResolvedValue( { running: false } );
		mockStop.mockImplementation(
			() =>
				new Promise( ( resolve ) => {
					resolveStop = resolve;
				} )
		);

		const { result } = renderHook( () => useRemoteSessionStatus() );
		await waitFor( () => expect( result.current.isRunning ).toBe( true ) );

		act( () => {
			void result.current.stop();
		} );
		expect( result.current.isRunning ).toBe( false );

		emitRemoteSessionStatus( { running: true } );
		expect( result.current.isRunning ).toBe( false );

		await act( async () => {
			resolveStop( { stopped: true } );
		} );

		await waitFor( () => expect( result.current.isLoading ).toBe( false ) );
		expect( result.current.isRunning ).toBe( false );
	} );

	it( 'stop() invokes stopRemoteSessionDaemon and surfaces failures via showErrorMessageBox', async () => {
		mockGetStatus.mockResolvedValueOnce( { running: true } ).mockResolvedValue( { running: true } );
		mockStop.mockRejectedValue( new Error( 'process refused to die' ) );

		const { result } = renderHook( () => useRemoteSessionStatus() );
		await waitFor( () => expect( result.current.isRunning ).toBe( true ) );

		await act( async () => {
			await result.current.stop();
		} );

		expect( mockStop ).toHaveBeenCalledOnce();
		expect( mockShowErrorMessageBox ).toHaveBeenCalledWith(
			expect.objectContaining( { message: 'process refused to die' } )
		);
	} );

	it( 'debounces concurrent start calls with a ref-backed in-flight guard', async () => {
		let resolveStart: ( value: { pid: number; pidFile: string } ) => void = () => undefined;
		mockGetStatus
			.mockResolvedValueOnce( { running: false } )
			.mockResolvedValue( { running: true } );
		mockStart.mockImplementation(
			() =>
				new Promise( ( resolve ) => {
					resolveStart = resolve;
				} )
		);

		const { result } = renderHook( () => useRemoteSessionStatus() );
		await waitFor( () => expect( result.current.isRunning ).toBe( false ) );

		act( () => {
			void result.current.start();
			void result.current.start();
		} );

		expect( result.current.isLoading ).toBe( true );
		expect( mockStart ).toHaveBeenCalledOnce();

		await act( async () => {
			resolveStart( { pid: 1, pidFile: '/tmp/pid' } );
		} );
		await waitFor( () => expect( result.current.isLoading ).toBe( false ) );
	} );
} );
