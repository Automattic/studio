import { afterEach, beforeEach, vi } from 'vitest';
import {
	__buildTracksPixelUrl,
	__recordTracksEvent,
	isTracksEventName,
	TRACKS_EVENTS,
	type TracksIdentity,
} from '../record-tracks-event';

const IDENTITY: TracksIdentity = { type: 'anon', id: 'install-uuid-123' };

describe( 'isTracksEventName', () => {
	it( 'accepts known event names', () => {
		expect( isTracksEventName( TRACKS_EVENTS.APP_LAUNCH ) ).toBe( true );
		expect( isTracksEventName( TRACKS_EVENTS.SITE_START ) ).toBe( true );
	} );

	it( 'rejects unknown or non-string values', () => {
		expect( isTracksEventName( 'studio_not_a_real_event' ) ).toBe( false );
		expect( isTracksEventName( '' ) ).toBe( false );
		expect( isTracksEventName( undefined ) ).toBe( false );
		expect( isTracksEventName( 42 ) ).toBe( false );
	} );
} );

describe( '__buildTracksPixelUrl', () => {
	it( 'targets the Tracks pixel endpoint with identity and timestamp params', () => {
		const url = new URL(
			__buildTracksPixelUrl( TRACKS_EVENTS.APP_LAUNCH, IDENTITY, {}, 1_700_000_000_000 )
		);

		expect( url.origin + url.pathname ).toBe( 'https://pixel.wp.com/t.gif' );
		expect( url.searchParams.get( '_en' ) ).toBe( 'studio_app_launch' );
		expect( url.searchParams.get( '_ut' ) ).toBe( 'anon' );
		expect( url.searchParams.get( '_ui' ) ).toBe( 'install-uuid-123' );
		expect( url.searchParams.get( '_ts' ) ).toBe( '1700000000000' );
	} );

	it( 'coerces prop values to strings and drops undefined props', () => {
		const url = new URL(
			__buildTracksPixelUrl( TRACKS_EVENTS.SITE_START, IDENTITY, {
				channel: 'studio-cli',
				is_a11n: true,
				count: 3,
				ui_version: undefined,
			} )
		);

		expect( url.searchParams.get( 'channel' ) ).toBe( 'studio-cli' );
		expect( url.searchParams.get( 'is_a11n' ) ).toBe( 'true' );
		expect( url.searchParams.get( 'count' ) ).toBe( '3' );
		expect( url.searchParams.has( 'ui_version' ) ).toBe( false );
	} );
} );

describe( '__recordTracksEvent', () => {
	const originalEnv = { ...process.env };

	beforeEach( () => {
		vi.stubGlobal(
			'fetch',
			vi.fn( () => Promise.resolve( new Response() ) )
		);
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
		process.env = { ...originalEnv };
	} );

	it( 'sends a fire-and-forget GET to the pixel endpoint', () => {
		delete process.env.E2E;
		process.env.NODE_ENV = 'production';

		const result = __recordTracksEvent( TRACKS_EVENTS.APP_LAUNCH, IDENTITY, {
			channel: 'studio-ui',
		} );

		expect( result ).toBe( true );
		expect( fetch ).toHaveBeenCalledTimes( 1 );
		const [ calledUrl, options ] = ( fetch as ReturnType< typeof vi.fn > ).mock.calls[ 0 ];
		expect( calledUrl ).toContain( 'https://pixel.wp.com/t.gif' );
		expect( calledUrl ).toContain( '_en=studio_app_launch' );
		expect( options ).toMatchObject( { method: 'GET' } );
	} );

	it( 'no-ops in E2E', () => {
		process.env.E2E = 'true';
		process.env.NODE_ENV = 'production';

		expect( __recordTracksEvent( TRACKS_EVENTS.APP_LAUNCH, IDENTITY, {} ) ).toBe( false );
		expect( fetch ).not.toHaveBeenCalled();
	} );

	it( 'no-ops in development', () => {
		delete process.env.E2E;
		process.env.NODE_ENV = 'development';

		expect( __recordTracksEvent( TRACKS_EVENTS.SITE_START, IDENTITY, {} ) ).toBe( false );
		expect( fetch ).not.toHaveBeenCalled();
	} );
} );
