import { IpcRendererEvent } from 'electron';
import { renderHook, waitFor } from '@testing-library/react';
import { act } from 'react';
import { vi } from 'vitest';
import { useFullscreen } from 'src/hooks/use-fullscreen';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { getIpcApi } from 'src/lib/get-ipc-api';

vi.mock( 'src/lib/get-ipc-api' );
vi.mock( 'src/hooks/use-ipc-listener' );

const mockIpcApi = {
	isFullscreen: vi.fn(),
};

vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( mockIpcApi );

describe( 'useFullscreen', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'should initialize with false and update when isFullscreen resolves', async () => {
		mockIpcApi.isFullscreen.mockResolvedValue( true );
		const { result } = renderHook( () => useFullscreen() );

		expect( result.current ).toBe( false );

		await waitFor( () => {
			expect( mockIpcApi.isFullscreen ).toHaveBeenCalledTimes( 1 );
			expect( result.current ).toBe( true );
		} );
	} );

	it( 'should update state when receiving window-fullscreen-change event', async () => {
		mockIpcApi.isFullscreen.mockResolvedValue( false );
		let eventHandler: ( _: IpcRendererEvent, fullscreen: boolean ) => void = () => undefined;
		vi.mocked( useIpcListener, { partial: true } ).mockImplementation( ( _channel, handler ) => {
			eventHandler = handler;
		} );

		const { result } = renderHook( () => useFullscreen() );

		await waitFor( () => {
			expect( mockIpcApi.isFullscreen ).toHaveBeenCalledTimes( 1 );
		} );

		await act( async () => {
			eventHandler( {} as IpcRendererEvent, true );
		} );

		expect( result.current ).toBe( true );

		await act( async () => {
			eventHandler( {} as IpcRendererEvent, false );
		} );

		expect( result.current ).toBe( false );
	} );

	it( 'should not update state if component is unmounted', async () => {
		let eventHandler: ( _: IpcRendererEvent, fullscreen: boolean ) => void = () => undefined;
		vi.mocked( useIpcListener, { partial: true } ).mockImplementation( ( _channel, handler ) => {
			eventHandler = handler;
		} );

		const { result, unmount } = renderHook( () => useFullscreen() );

		expect( result.current ).toBe( false );

		unmount();

		await act( async () => {
			eventHandler( {} as IpcRendererEvent, true );
		} );

		expect( result.current ).toBe( false );
	} );
} );
