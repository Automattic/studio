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

/**
 * Helper to set up fs mocks: readFileSync returns wp-config content,
 * existsSync returns true for any path in the existingPaths set.
 */
function setupMocks( wpConfigContent: string, existingPaths: string[] = [] ) {
	mockedFs.readFileSync.mockReturnValue( wpConfigContent );
	mockedFs.existsSync.mockImplementation( ( p: fs.PathLike ) => {
		const resolved = nodePath.resolve( p.toString() );
		return existingPaths.some( ( ep ) => resolved === nodePath.resolve( ep ) );
	} );
}

describe( 'getWpConfigMountPaths', () => {
	it( 'should return empty array when wp-config.php does not exist', () => {
		mockedFs.readFileSync.mockImplementation( () => {
			throw new Error( 'ENOENT: no such file or directory' );
		} );
		expect( getWpConfigMountPaths( MOCK_SITE_PATH ) ).toEqual( [] );
	} );

	it( 'should return empty array when wp-config.php has no define() with paths', () => {
		setupMocks( `<?php
define( 'DB_NAME', 'wordpress' );
define( 'DB_USER', 'root' );
define( 'WP_DEBUG', true );
` );
		expect( getWpConfigMountPaths( MOCK_SITE_PATH ) ).toEqual( [] );
	} );

	it( 'should detect absolute path constants outside the site folder', () => {
		setupMocks(
			`<?php
define( 'MY_WORKSPACE', '/external/workspace' );
`,
			[ '/external/workspace' ]
		);

		const mounts = getWpConfigMountPaths( MOCK_SITE_PATH );
		expect( mounts ).toEqual( [
			{
				hostPath: nodePath.resolve( '/external/workspace' ),
				vfsPath: nodePath.resolve( '/external/workspace' ),
			},
		] );
	} );

	it( 'should detect multiple path constants', () => {
		setupMocks(
			`<?php
define( 'WORKSPACE_PATH', '/external/workspace' );
define( 'DATA_DIR', '/external/data' );
`,
			[ '/external/workspace', '/external/data' ]
		);

		const mounts = getWpConfigMountPaths( MOCK_SITE_PATH );
		expect( mounts ).toHaveLength( 2 );
	} );

	it( 'should skip paths inside the site folder', () => {
		setupMocks(
			`<?php
define( 'INTERNAL_PATH', '${ MOCK_SITE_PATH }/wp-content/uploads' );
define( 'EXTERNAL_PATH', '/external/data' );
`,
			[ `${ MOCK_SITE_PATH }/wp-content/uploads`, '/external/data' ]
		);

		const mounts = getWpConfigMountPaths( MOCK_SITE_PATH );
		expect( mounts ).toHaveLength( 1 );
		expect( mounts[ 0 ].hostPath ).toBe( nodePath.resolve( '/external/data' ) );
	} );

	it( 'should skip paths that do not exist on disk', () => {
		setupMocks(
			`<?php
define( 'MISSING_PATH', '/does/not/exist' );
define( 'EXISTING_PATH', '/external/exists' );
`,
			[ '/external/exists' ]
		);

		const mounts = getWpConfigMountPaths( MOCK_SITE_PATH );
		expect( mounts ).toHaveLength( 1 );
		expect( mounts[ 0 ].hostPath ).toBe( nodePath.resolve( '/external/exists' ) );
	} );

	it( 'should deduplicate paths referenced by multiple constants', () => {
		setupMocks(
			`<?php
define( 'PATH_A', '/external/shared' );
define( 'PATH_B', '/external/shared' );
`,
			[ '/external/shared' ]
		);

		const mounts = getWpConfigMountPaths( MOCK_SITE_PATH );
		expect( mounts ).toHaveLength( 1 );
	} );

	it( 'should skip sensitive system paths', () => {
		setupMocks(
			`<?php
define( 'SYSTEM_ETC', '/etc/ssl' );
define( 'SYSTEM_VAR', '/var/log' );
define( 'SAFE_PATH', '/external/safe' );
`,
			[ '/etc/ssl', '/var/log', '/external/safe' ]
		);

		const mounts = getWpConfigMountPaths( MOCK_SITE_PATH );
		expect( mounts ).toHaveLength( 1 );
		expect( mounts[ 0 ].hostPath ).toBe( nodePath.resolve( '/external/safe' ) );
	} );

	it( 'should handle double-quoted define() calls', () => {
		setupMocks(
			`<?php
define("MY_PATH", "/external/double-quoted");
`,
			[ '/external/double-quoted' ]
		);

		const mounts = getWpConfigMountPaths( MOCK_SITE_PATH );
		expect( mounts ).toHaveLength( 1 );
	} );

	it( 'should ignore non-absolute paths (regex only matches paths starting with /)', () => {
		setupMocks(
			`<?php
define( 'RELATIVE_PATH', 'relative/path' );
define( 'DB_NAME', 'wordpress' );
define( 'ABS_PATH', '/external/real' );
`,
			[ '/external/real' ]
		);

		const mounts = getWpConfigMountPaths( MOCK_SITE_PATH );
		expect( mounts ).toHaveLength( 1 );
		expect( mounts[ 0 ].hostPath ).toBe( nodePath.resolve( '/external/real' ) );
	} );

	it( 'should handle a realistic wp-config.php with mixed content', () => {
		setupMocks(
			`<?php
/**
 * WordPress configuration file.
 */
define( 'DB_NAME', 'wordpress' );
define( 'DB_USER', 'root' );
define( 'DB_PASSWORD', '' );
define( 'DB_HOST', 'localhost' );
define( 'WP_DEBUG', true );
define( 'ABSPATH', '${ MOCK_SITE_PATH }/' );
define( 'MY_WORKSPACE_PATH', '/Users/me/Developer' );
define( 'DATAMACHINE_AGENT_DIR', '/Users/me/.datamachine' );

if ( ! defined( 'ABSPATH' ) ) {
    define( 'ABSPATH', __DIR__ . '/' );
}

require_once ABSPATH . 'wp-settings.php';
`,
			[ '/Users/me/Developer', '/Users/me/.datamachine' ]
		);

		const mounts = getWpConfigMountPaths( MOCK_SITE_PATH );
		// Should find MY_WORKSPACE_PATH and DATAMACHINE_AGENT_DIR
		// Should skip ABSPATH (inside site folder) and non-path defines
		expect( mounts ).toHaveLength( 2 );
		expect( mounts.map( ( m ) => m.hostPath ) ).toEqual( [
			nodePath.resolve( '/Users/me/Developer' ),
			nodePath.resolve( '/Users/me/.datamachine' ),
		] );
	} );
} );
