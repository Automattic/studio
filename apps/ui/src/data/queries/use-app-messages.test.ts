import { describe, expect, it } from 'vitest';
import { deriveActiveMessages, type PersistentMessage } from './use-app-messages';

const message = ( id: string ): PersistentMessage => ( {
	id,
	intent: 'info',
	title: id,
} );

describe( 'deriveActiveMessages', () => {
	it( 'passes messages through when nothing is dismissed', () => {
		const sources = [ message( 'a' ), message( 'b' ) ];
		expect( deriveActiveMessages( sources, [], [] ) ).toEqual( sources );
	} );

	it( 'filters persisted dismissals', () => {
		const sources = [ message( 'app-update:1.2.3' ), message( 'announcement:sale' ) ];
		expect( deriveActiveMessages( sources, [ 'announcement:sale' ], [] ) ).toEqual( [
			sources[ 0 ],
		] );
	} );

	it( 'filters session-only dismissals', () => {
		const sources = [ message( 'app-update' ) ];
		expect( deriveActiveMessages( sources, [], [ 'app-update' ] ) ).toEqual( [] );
	} );

	it( 'a dismissal for one version does not hide the next', () => {
		const sources = [ message( 'app-update:2.0.0' ) ];
		expect( deriveActiveMessages( sources, [ 'app-update:1.2.3' ], [] ) ).toEqual( sources );
	} );
} );
