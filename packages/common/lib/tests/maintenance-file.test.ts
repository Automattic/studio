import fs from 'fs';
import { checkMaintenanceFile } from '../maintenance-file';

describe( 'checkMaintenanceFile', () => {
	const sitePath = '/tmp/test-site';

	beforeEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'returns exists: false when no .maintenance file exists', () => {
		vi.spyOn( fs, 'existsSync' ).mockReturnValue( false );

		const result = checkMaintenanceFile( sitePath );

		expect( result ).toEqual( { exists: false } );
	} );

	it( 'returns isStale: false for a recent timestamp', () => {
		const nowSeconds = Math.floor( Date.now() / 1000 );
		vi.spyOn( fs, 'existsSync' ).mockReturnValue( true );
		vi.spyOn( fs, 'readFileSync' ).mockReturnValue( `<?php $upgrading = ${ nowSeconds }; ?>` );

		const result = checkMaintenanceFile( sitePath );

		expect( result ).toEqual( { exists: true, isStale: false } );
	} );

	it( 'returns isStale: true for an old timestamp', () => {
		const oldTimestamp = Math.floor( Date.now() / 1000 ) - 700;
		vi.spyOn( fs, 'existsSync' ).mockReturnValue( true );
		vi.spyOn( fs, 'readFileSync' ).mockReturnValue( `<?php $upgrading = ${ oldTimestamp }; ?>` );

		const result = checkMaintenanceFile( sitePath );

		expect( result ).toEqual( { exists: true, isStale: true } );
	} );

	it( 'treats a malformed file as stale', () => {
		vi.spyOn( fs, 'existsSync' ).mockReturnValue( true );
		vi.spyOn( fs, 'readFileSync' ).mockReturnValue( '<?php // broken file' );

		const result = checkMaintenanceFile( sitePath );

		expect( result ).toEqual( { exists: true, isStale: true } );
	} );

	it( 'treats an empty file as stale', () => {
		vi.spyOn( fs, 'existsSync' ).mockReturnValue( true );
		vi.spyOn( fs, 'readFileSync' ).mockReturnValue( '' );

		const result = checkMaintenanceFile( sitePath );

		expect( result ).toEqual( { exists: true, isStale: true } );
	} );

	it( 'treats an unreadable file as stale', () => {
		vi.spyOn( fs, 'existsSync' ).mockReturnValue( true );
		vi.spyOn( fs, 'readFileSync' ).mockImplementation( () => {
			throw new Error( 'EACCES: permission denied' );
		} );

		const result = checkMaintenanceFile( sitePath );

		expect( result ).toEqual( { exists: true, isStale: true } );
	} );
} );
