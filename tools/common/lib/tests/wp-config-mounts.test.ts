import fs from 'fs';
import nodePath from 'path';
import { vi } from 'vitest';
import { getWpConfigMountPaths } from '../wp-config-mounts';

vi.mock( 'fs' );

const mockedFs = vi.mocked( fs );
const MOCK_SITE_PATH = '/sites/my-site';

beforeEach( () => {
	vi.resetAllMocks();
} );

function mockWpConfig( wpConfigContent: string, existingPaths: string[] = [] ) {
	mockedFs.readFileSync.mockReturnValue( wpConfigContent );
	mockedFs.existsSync.mockImplementation( ( p: fs.PathLike ) => {
		const resolved = nodePath.resolve( p.toString() );
		return existingPaths.some( ( existingPath ) => resolved === nodePath.resolve( existingPath ) );
	} );
}

describe( 'getWpConfigMountPaths', () => {
	it( 'returns no mounts when wp-config.php is missing', () => {
		mockedFs.readFileSync.mockImplementation( () => {
			throw new Error( 'ENOENT: no such file or directory' );
		} );

		expect( getWpConfigMountPaths( MOCK_SITE_PATH ) ).toEqual( [] );
	} );

	it( 'mounts existing absolute path constants at their real host paths', () => {
		mockWpConfig(
			`<?php
define( 'WORKSPACE_PATH', '/external/workspace' );
define( "DATA_DIR", "/external/data" );
`,
			[ '/external/workspace', '/external/data' ]
		);

		expect( getWpConfigMountPaths( MOCK_SITE_PATH ) ).toEqual( [
			{
				hostPath: nodePath.resolve( '/external/workspace' ),
				vfsPath: nodePath.resolve( '/external/workspace' ),
			},
			{
				hostPath: nodePath.resolve( '/external/data' ),
				vfsPath: nodePath.resolve( '/external/data' ),
			},
		] );
	} );

	it( 'skips paths that should not become extra mounts', () => {
		mockWpConfig(
			`<?php
define( 'DB_NAME', 'wordpress' );
define( 'RELATIVE_PATH', 'relative/path' );
define( 'INTERNAL_PATH', '${ MOCK_SITE_PATH }/wp-content/uploads' );
define( 'MISSING_PATH', '/does/not/exist' );
define( 'SYSTEM_PATH', '/etc/ssl' );
define( 'SAFE_PATH', '/external/safe' );
`,
			[ `${ MOCK_SITE_PATH }/wp-content/uploads`, '/etc/ssl', '/external/safe' ]
		);

		expect( getWpConfigMountPaths( MOCK_SITE_PATH ) ).toEqual( [
			{
				hostPath: nodePath.resolve( '/external/safe' ),
				vfsPath: nodePath.resolve( '/external/safe' ),
			},
		] );
	} );

	it( 'deduplicates repeated paths', () => {
		mockWpConfig(
			`<?php
define( 'PATH_A', '/external/shared' );
define( 'PATH_B', '/external/shared' );
`,
			[ '/external/shared' ]
		);

		expect( getWpConfigMountPaths( MOCK_SITE_PATH ) ).toHaveLength( 1 );
	} );
} );
