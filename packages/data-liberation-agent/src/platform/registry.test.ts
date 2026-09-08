import { describe, expect, it } from 'vitest';
import {
	ConflictingFallbackError,
	DuplicatePlatformError,
	InvalidPlatformError,
	fallbackPlatform,
	findPlatform,
	registerPlatform,
	registeredPlatforms,
	resolvePlatform,
} from './registry.js';

// This file imports ONLY the registry (never ./builtins.js), so it exercises
// the registry against a clean slate — exactly what a third-party consumer
// that never triggers built-in registration would see. The registry is module
// state shared across this file's tests, so they build one narrative flow:
// each `it` registers distinct ids and the fallback is registered exactly once.
const stub = ( id: string ) => ( {
	id,
	discover: async () => ( { urls: [] } ),
} );

describe( 'platform registry', () => {
	it( 'registers a platform and makes it resolvable by exact id', () => {
		const platform = stub( 'consumer-a' );
		registerPlatform( platform );
		expect( findPlatform( 'consumer-a' ) ).toBe( platform );
		expect( registeredPlatforms().map( ( p ) => p.id ) ).toContain( 'consumer-a' );
	} );

	it( 'registers platforms in registration order', () => {
		registerPlatform( stub( 'order-a' ) );
		registerPlatform( stub( 'order-b' ) );
		const ids = registeredPlatforms().map( ( p ) => p.id );
		expect( ids.indexOf( 'order-a' ) ).toBeLessThan( ids.indexOf( 'order-b' ) );
	} );

	it( 'throws deterministically on a duplicate id', () => {
		registerPlatform( stub( 'dup-1' ) );
		expect( () => registerPlatform( stub( 'dup-1' ) ) ).toThrow( DuplicatePlatformError );
		expect( () => registerPlatform( stub( 'dup-1' ) ) ).toThrow(
			/Already registered with id 'dup-1'/i,
		);
		// The original registration is untouched, not shadowed or replaced.
		expect( registeredPlatforms().filter( ( p ) => p.id === 'dup-1' ) ).toHaveLength( 1 );
	} );

	it( 'registers the one generic fallback', () => {
		const fallback = stub( 'the-fallback' );
		registerPlatform( fallback, { fallback: true } );
		expect( fallbackPlatform() ).toBe( fallback );
		// Unregistered ids (including detection misses) resolve to it.
		expect( resolvePlatform( 'never-registered' ) ).toBe( fallback );
		expect( resolvePlatform( 'unknown' ) ).toBe( fallback );
	} );

	it( 'throws deterministically when a second fallback is registered', () => {
		expect( () => registerPlatform( stub( 'fallback-two' ), { fallback: true } ) ).toThrow(
			ConflictingFallbackError,
		);
		// The original fallback is untouched.
		expect( fallbackPlatform()?.id ).toBe( 'the-fallback' );
	} );

	it( 'throws when a fallback declares detection signals (ambiguous selection)', () => {
		expect( () =>
			registerPlatform(
				{ ...stub( 'ambiguous-fallback' ), detection: { urlPatterns: [ /ambiguous/i ] } },
				{ fallback: true },
			),
		).toThrow( InvalidPlatformError );
	} );

	it( 'reserves the unknown sentinel id', () => {
		expect( () => registerPlatform( stub( 'unknown' ) ) ).toThrow( InvalidPlatformError );
	} );

	it.each( [
		[ 'missing id', { discover: async () => ( {} ) } ],
		[ 'blank id', { id: '   ', discover: async () => ( {} ) } ],
		[ 'missing discover', { id: 'no-discover' } ],
		[
			'non-array urlPatterns',
			{
				id: 'bad-tier',
				discover: async () => ( {} ),
				detection: { urlPatterns: /not-an-array/i },
			},
		],
	] )( 'rejects a malformed platform (%s)', ( _label, platform ) => {
		expect( () => registerPlatform( platform as never ) ).toThrow( InvalidPlatformError );
	} );

	it( 'resolves an exact id match over the fallback', () => {
		registerPlatform( stub( 'exact-wins' ) );
		expect( resolvePlatform( 'exact-wins' )?.id ).toBe( 'exact-wins' );
	} );

	it( 'exact lookups never fall back', () => {
		// findPlatform never falls back — only resolvePlatform does (a fallback
		// IS registered at this point in the flow).
		expect( findPlatform( 'nothing-registered' ) ).toBeNull();
	} );
} );
