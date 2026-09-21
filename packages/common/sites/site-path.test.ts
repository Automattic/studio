import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readSitePath } from './site-path';

const readCliConfigFileRaw = vi.hoisted( () => vi.fn() );

vi.mock( '@studio/common/lib/cli-config-file', () => ( { readCliConfigFileRaw } ) );

describe( 'readSitePath', () => {
	beforeEach( () => {
		readCliConfigFileRaw.mockReset();
	} );

	it( 'resolves the path of the requested site', async () => {
		readCliConfigFileRaw.mockResolvedValue( {
			sites: [
				{ id: 'aaa', path: '/Users/dev/Studio/first', port: 8881 },
				{ id: 'bbb', path: '/Users/dev/Studio/second', port: 8882 },
			],
		} );

		await expect( readSitePath( 'bbb' ) ).resolves.toBe( '/Users/dev/Studio/second' );
	} );

	it( 'returns null for an unknown site', async () => {
		readCliConfigFileRaw.mockResolvedValue( { sites: [ { id: 'aaa', path: '/site' } ] } );

		await expect( readSitePath( 'missing' ) ).resolves.toBeNull();
	} );

	it( 'returns null when the config has no sites yet', async () => {
		readCliConfigFileRaw.mockResolvedValue( {} );

		await expect( readSitePath( 'aaa' ) ).resolves.toBeNull();
	} );

	it( 'returns null when the config cannot be read', async () => {
		readCliConfigFileRaw.mockRejectedValue( new Error( 'unreadable' ) );

		await expect( readSitePath( 'aaa' ) ).resolves.toBeNull();
	} );
} );
