import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createKeepAlive } from '../keep-alive';

const URL = 'https://server.example/api/health';
const FIVE_MINUTES = 5 * 60_000;

let busy: boolean;
const request = vi.fn< typeof fetch >();

beforeEach( () => {
	vi.useFakeTimers();
	busy = true;
	request.mockReset().mockResolvedValue( new Response( 'ok' ) );
	vi.stubGlobal( 'fetch', request );
} );

afterEach( () => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
} );

const start = () => createKeepAlive( { url: URL, isBusy: () => busy } );

it( 'requests the URL when a run starts, then every five minutes while one is in progress', () => {
	const keepAlive = start();

	keepAlive.wake();
	expect( request ).toHaveBeenCalledTimes( 1 );
	expect( request ).toHaveBeenCalledWith( URL );

	vi.advanceTimersByTime( FIVE_MINUTES - 1 );
	expect( request ).toHaveBeenCalledTimes( 1 );
	vi.advanceTimersByTime( 1 );
	expect( request ).toHaveBeenCalledTimes( 2 );

	keepAlive.wake();
	expect( request ).toHaveBeenCalledTimes( 2 );
	vi.advanceTimersByTime( FIVE_MINUTES );
	expect( request ).toHaveBeenCalledTimes( 3 );
	keepAlive.stop();
} );

it( 'stops once no run is left, and starts again with the next run', () => {
	const keepAlive = start();
	keepAlive.wake();

	busy = false;
	vi.advanceTimersByTime( FIVE_MINUTES * 3 );
	expect( request ).toHaveBeenCalledTimes( 1 );
	expect( vi.getTimerCount() ).toBe( 0 );

	busy = true;
	keepAlive.wake();
	expect( request ).toHaveBeenCalledTimes( 2 );
	keepAlive.stop();
} );

it( 'keeps going after a failed request', async () => {
	vi.spyOn( console, 'debug' ).mockImplementation( () => undefined );
	request.mockRejectedValue( new Error( 'offline' ) );
	const keepAlive = start();

	keepAlive.wake();
	await vi.advanceTimersByTimeAsync( FIVE_MINUTES );

	expect( request ).toHaveBeenCalledTimes( 2 );
	keepAlive.stop();
} );

it( 'does nothing without a URL', () => {
	createKeepAlive( { isBusy: () => busy } ).wake();
	vi.advanceTimersByTime( FIVE_MINUTES * 3 );

	expect( request ).not.toHaveBeenCalled();
	expect( vi.getTimerCount() ).toBe( 0 );
} );
