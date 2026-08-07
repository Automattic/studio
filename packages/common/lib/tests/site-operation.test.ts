import { describe, expect, it } from 'vitest';
import { getBlockingOperation } from '../site-operation';

describe( 'getBlockingOperation', () => {
	it( 'reports nothing for an idle site', () => {
		expect( getBlockingOperation( undefined ) ).toBeNull();
		expect( getBlockingOperation( [] ) ).toBeNull();
	} );

	it( 'names the operation holding the site', () => {
		expect( getBlockingOperation( [ { id: 'a', pid: 1, kind: 'push' } ] ) ).toBe( 'push' );
	} );
} );
