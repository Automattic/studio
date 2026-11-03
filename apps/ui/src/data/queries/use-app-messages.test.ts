import { describe, expect, it } from 'vitest';
import { deriveUpdateMessages } from './use-app-messages';

describe( 'deriveUpdateMessages', () => {
	it( 'shows nothing while idle, checking, or before the first status arrives', () => {
		expect( deriveUpdateMessages( undefined ) ).toEqual( [] );
		expect( deriveUpdateMessages( { state: 'idle', currentVersion: '1.20.0' } ) ).toEqual( [] );
		expect( deriveUpdateMessages( { state: 'checking', currentVersion: '1.20.0' } ) ).toEqual( [] );
	} );

	it( 'names both versions while downloading', () => {
		const [ message ] = deriveUpdateMessages( {
			state: 'downloading',
			currentVersion: '1.20.0',
			newVersion: '1.21.0',
		} );

		expect( message.title ).toBe( 'Downloading update' );
		expect( message.description ).toBe( 'Updating from 1.20.0 to 1.21.0.' );
		expect( message.action ).toBeUndefined();
	} );

	it( 'falls back to the current version when the target is not yet known', () => {
		const [ message ] = deriveUpdateMessages( {
			state: 'downloading',
			currentVersion: '1.20.0',
			newVersion: null,
		} );

		expect( message.description ).toBe( 'Updating from 1.20.0.' );
	} );

	it.each( [ '1.21.0', null ] )(
		'leaves ready updates to the update button (%s)',
		( newVersion ) => {
			expect(
				deriveUpdateMessages( { state: 'ready', currentVersion: '1.20.0', newVersion } )
			).toEqual( [] );
		}
	);

	it( 'leaves update errors to regular notices rather than sidebar cards', () => {
		expect(
			deriveUpdateMessages( {
				state: 'error',
				currentVersion: '1.20.0',
				reason: 'generic',
			} )
		).toEqual( [] );
	} );
} );
