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
} );

afterEach( () => {
	vi.useRealTimers();
} );

it( 'requests the URL when a run starts, then every five minutes while one is in progress', () => {
	const keepAlive = createKeepAlive( { url: URL, isBusy: () => busy, fetch: request } );

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
	const keepAlive = createKeepAlive( { url: URL, isBusy: () => busy, fetch: request } );
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

it( 'ignores failed requests', async () => {
	const debug = vi.spyOn( console, 'debug' ).mockImplementation( () => undefined );
	request.mockRejectedValue( new Error( 'offline' ) );
	const keepAlive = createKeepAlive( { url: URL, isBusy: () => busy, fetch: request } );

	keepAlive.wake();
	await vi.advanceTimersByTimeAsync( FIVE_MINUTES );

	expect( request ).toHaveBeenCalledTimes( 2 );
	expect( debug ).toHaveBeenCalled();
	keepAlive.stop();
} );

it( 'does nothing without a URL', () => {
	const keepAlive = createKeepAlive( { url: undefined, isBusy: () => busy, fetch: request } );

	keepAlive.wake();
	vi.advanceTimersByTime( FIVE_MINUTES * 3 );

	expect( request ).not.toHaveBeenCalled();
	expect( vi.getTimerCount() ).toBe( 0 );
} );
