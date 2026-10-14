import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listSitesWithMetadata, updateSiteMetadata } from './metadata';

const appConfig = vi.hoisted( () => ( { current: {} as Record< string, unknown > } ) );
const listSites = vi.hoisted( () => vi.fn() );

vi.mock( '@studio/common/lib/app-config', () => ( {
	readAppConfig: async () => appConfig.current,
	updateAppConfig: async ( mutate: ( config: Record< string, unknown > ) => void ) =>
		mutate( appConfig.current ),
} ) );
vi.mock( './list', () => ( { listSites } ) );

describe( 'site metadata', () => {
	beforeEach( () => {
		appConfig.current = {
			siteMetadata: {
				a: { sortOrder: 2, autoStart: true, futureField: 'kept' },
				b: { sortOrder: 1 },
			},
		};
	} );

	it( 'merges patches, removes sites patched with null, and keeps unknown fields', async () => {
		await updateSiteMetadata( { a: { autoStart: false }, b: null, c: { sortOrder: 3 } } );

		expect( appConfig.current.siteMetadata ).toEqual( {
			a: { sortOrder: 2, autoStart: false, futureField: 'kept' },
			c: { sortOrder: 3 },
		} );
	} );

	it( 'merges each listed site with its metadata, letting the CLI win on shared fields', async () => {
		listSites.mockResolvedValue( [
			{ id: 'a', name: 'A', running: true },
			{ id: 'z', name: 'Z', running: false },
		] );

		await expect( listSitesWithMetadata( vi.fn() ) ).resolves.toEqual( [
			expect.objectContaining( { id: 'a', name: 'A', sortOrder: 2, autoStart: true } ),
			expect.objectContaining( { id: 'z', name: 'Z', sortOrder: undefined } ),
		] );
	} );
} );
