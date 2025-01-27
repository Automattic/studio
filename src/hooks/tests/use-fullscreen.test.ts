import { renderHook, waitFor } from '@testing-library/react';
import { act } from 'react';
import { getIpcApi } from '../../lib/get-ipc-api';
import { useFullscreen } from '../use-fullscreen';
import { useIpcListener } from '../use-ipc-listener';

jest.mock( '../../lib/get-ipc-api' );
jest.mock( '../use-ipc-listener' );

const mockIpcApi = {
	isFullscreen: jest.fn(),
};

( getIpcApi as jest.Mock ).mockReturnValue( mockIpcApi );

describe( 'useFullscreen', () => {
	beforeEach( () => {
		jest.clearAllMocks();
	} );

	it( 'should initialize with false and update when isFullscreen resolves', async () => {
		mockIpcApi.isFullscreen.mockResolvedValue( true );
		const { result } = renderHook( () => useFullscreen() );

		expect( result.current ).toBe( false );

		await waitFor( () => {
			expect( mockIpcApi.isFullscreen ).toHaveBeenCalledTimes( 1 );
		} );

		expect( result.current ).toBe( true );
	} );

	it( 'should update state when receiving window-fullscreen-change event', async () => {
		mockIpcApi.isFullscreen.mockResolvedValue( false );
		let eventHandler: ( _: unknown, fullscreen: boolean ) => void = () => undefined;
		( useIpcListener as jest.Mock ).mockImplementation( ( _channel, handler ) => {
			eventHandler = handler;
		} );

		const { result } = renderHook( () => useFullscreen() );

		await waitFor( () => {
			expect( mockIpcApi.isFullscreen ).toHaveBeenCalledTimes( 1 );
		} );

		await act( async () => {
			eventHandler( null, true );
		} );

		expect( result.current ).toBe( true );

		await act( async () => {
			eventHandler( null, false );
		} );

		expect( result.current ).toBe( false );
	} );

	it( 'should not update state if component is unmounted', async () => {
		let eventHandler: ( _: unknown, fullscreen: boolean ) => void = () => undefined;
		( useIpcListener as jest.Mock ).mockImplementation( ( _channel, handler ) => {
			eventHandler = handler;
		} );

		const { result, unmount } = renderHook( () => useFullscreen() );

		expect( result.current ).toBe( false );

		unmount();

		await act( async () => {
			eventHandler( null, true );
		} );

		expect( result.current ).toBe( false );
	} );
} );
