import fs from 'fs';
import nodePath from 'path';
import { vi } from 'vitest';
import { isMultisite } from '../is-multisite';

vi.mock( 'fs' );

const mockedFs = vi.mocked( fs );

describe( 'isMultisite', () => {
	const wordPressPath = '/path/to/wordpress';
	const wpConfigPath = nodePath.join( wordPressPath, 'wp-config.php' );

	beforeEach( () => {
		vi.resetAllMocks();
	} );

	it( 'returns true when MULTISITE is defined as true with single quotes', () => {
		mockedFs.readFileSync.mockReturnValue( "define( 'MULTISITE', true );" );
		expect( isMultisite( wordPressPath ) ).toBe( true );
		expect( mockedFs.readFileSync ).toHaveBeenCalledWith( wpConfigPath, 'utf8' );
	} );

	it( 'returns true when MULTISITE is defined as true with double quotes', () => {
		mockedFs.readFileSync.mockReturnValue( 'define( "MULTISITE", true );' );
		expect( isMultisite( wordPressPath ) ).toBe( true );
	} );

	it( 'returns true when MULTISITE is defined without spaces', () => {
		mockedFs.readFileSync.mockReturnValue( "define('MULTISITE',true);" );
		expect( isMultisite( wordPressPath ) ).toBe( true );
	} );

	it( 'returns false when MULTISITE is not present', () => {
		mockedFs.readFileSync.mockReturnValue( "define( 'DB_NAME', 'wordpress' );" );
		expect( isMultisite( wordPressPath ) ).toBe( false );
	} );

	it( 'returns false when MULTISITE is set to false', () => {
		mockedFs.readFileSync.mockReturnValue( "define( 'MULTISITE', false );" );
		expect( isMultisite( wordPressPath ) ).toBe( false );
	} );

	it( 'returns false when wp-config.php does not exist', () => {
		mockedFs.readFileSync.mockImplementation( () => {
			throw new Error( 'ENOENT: no such file or directory' );
		} );
		expect( isMultisite( wordPressPath ) ).toBe( false );
	} );

	it( 'returns true within a full wp-config.php file', () => {
		const fullConfig = `<?php
define( 'DB_NAME', 'database_name_here' );
define( 'WP_ALLOW_MULTISITE', true );
define( 'MULTISITE', true );
define( 'SUBDOMAIN_INSTALL', false );
`;
		mockedFs.readFileSync.mockReturnValue( fullConfig );
		expect( isMultisite( wordPressPath ) ).toBe( true );
	} );
} );
