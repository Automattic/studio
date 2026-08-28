import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	findPublishTarget,
	publishTargetNames,
	registerPublishTarget,
	unregisterPublishTarget,
	type PublishTarget,
} from './index.js';

const custom = ( name: string ): PublishTarget => ( {
	name,
	publish: vi.fn( async () => ( {
		target: name,
		liveUrl: `https://${ name }.example/`,
		files: 1,
		bytes: 10,
		notes: [],
	} ) ),
} );

// Only the test-owned target is removed; the built-in registration is shared
// state and unregistering it would leak across tests.
afterEach( () => unregisterPublishTarget( 'acme' ) );

describe( 'publish target registry', () => {
	it( 'registers the built-in through the public API', () => {
		// The built-in must not be privileged: it appears because it registered.
		expect( publishTargetNames() ).toContain( 'spacefast' );
		expect( findPublishTarget( 'spacefast' )?.name ).toBe( 'spacefast' );
	} );

	it( 'accepts a target from outside this package', async () => {
		registerPublishTarget( custom( 'acme' ) );
		const target = findPublishTarget( 'acme' );
		expect( target ).not.toBeNull();
		await expect( target!.publish( { directory: '/tmp/site' } ) ).resolves.toMatchObject( {
			target: 'acme',
			liveUrl: 'https://acme.example/',
		} );
	} );

	it( 'resolves names case-insensitively and ignores surrounding space', () => {
		registerPublishTarget( custom( 'acme' ) );
		expect( findPublishTarget( '  ACME ' )?.name ).toBe( 'acme' );
	} );

	it( 'refuses to silently overwrite an existing name', () => {
		registerPublishTarget( custom( 'acme' ) );
		expect( () => registerPublishTarget( custom( 'acme' ) ) ).toThrow( /already registered/ );
	} );

	it( 'replaces a registration when asked explicitly', async () => {
		registerPublishTarget( custom( 'acme' ) );
		const replacement: PublishTarget = {
			name: 'acme',
			publish: async () => ( {
				target: 'acme',
				liveUrl: 'https://replaced.example/',
				files: 0,
				bytes: 0,
				notes: [],
			} ),
		};
		registerPublishTarget( replacement, { replace: true } );
		await expect(
			findPublishTarget( 'acme' )!.publish( { directory: '/tmp/site' } )
		).resolves.toMatchObject( { liveUrl: 'https://replaced.example/' } );
	} );

	it( 'rejects a nameless target', () => {
		expect( () => registerPublishTarget( custom( '   ' ) ) ).toThrow( /needs a name/ );
	} );

	it( 'reports an unregistered name as absent', () => {
		expect( findPublishTarget( 'nowhere' ) ).toBeNull();
	} );

	it( 'unregisters a target', () => {
		registerPublishTarget( custom( 'acme' ) );
		expect( unregisterPublishTarget( 'acme' ) ).toBe( true );
		expect( findPublishTarget( 'acme' ) ).toBeNull();
		expect( unregisterPublishTarget( 'acme' ) ).toBe( false );
	} );
} );
